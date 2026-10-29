import { ESLintUtils } from '@typescript-eslint/utils';
import path from 'node:path';
import ts from 'typescript';

// Spec 002 criterion 8, docs/adr/004-frontend-architecture.md. A data-access lib types what the core returns with the
// types generated from the core's OpenAPI contract (libs/api-contracts), never with a hand-written copy. The check
// runs on the resolved type, not on the name written in the code, so an alias of a local interface, a local interface
// that extends a contract type, or an intersection with a local type all fail. The calls are recognised by the
// signature they resolve to, so a variable alias of httpResource or a subclass of HttpClient is checked too.

// Only the generated files count: the `check` target proves they match the core's OpenAPI document.
const CONTRACT_DIR = path.resolve(
  import.meta.dirname,
  '../../../libs/api-contracts/src/generated',
);
const isContractFile = (fileName) =>
  path.resolve(fileName).startsWith(CONTRACT_DIR + path.sep);
const ANGULAR_COMMON = /[\\/]@angular[\\/]common[\\/]/;

/** `HttpClient.get` and friends, or `httpResource(…)`, `httpResource.text(…)` and friends; otherwise undefined. */
function httpCallName(declaration) {
  if (
    !declaration ||
    !ANGULAR_COMMON.test(declaration.getSourceFile().fileName)
  )
    return undefined;
  // httpResource.text/blob/arrayBuffer are call signatures in a type literal: HttpResourceFn > property > literal.
  if (
    ts.isTypeLiteralNode(declaration.parent) &&
    ts.isPropertySignature(declaration.parent.parent) &&
    ts.isInterfaceDeclaration(declaration.parent.parent.parent) &&
    declaration.parent.parent.parent.name.text === 'HttpResourceFn'
  ) {
    return `httpResource.${declaration.parent.parent.name.getText()}`;
  }
  const owner = declaration.parent;
  const ownerName =
    owner && (ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner))
      ? owner.name?.text
      : undefined;
  const member =
    declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined;
  if (ownerName === 'HttpClient') return `HttpClient.${member}`;
  if (ownerName === 'HttpResourceFn')
    return member ? `httpResource.${member}` : 'httpResource';
  return undefined;
}

/** The declarations of a type reference's name, through import aliases. */
function declarationsOf(checker, typeName) {
  const symbol = checker.getSymbolAtLocation(typeName);
  const resolved =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return resolved?.declarations ?? [];
}

/**
 * True when the written type is a lookup into a contract type, e.g. `components['schemas']['Health']['status']`, or a
 * local alias of one. Covers contract schemas that resolve to a primitive or a union of literals, which have no
 * declaration of their own.
 */
function isContractLookup(checker, typeNode, depth = 0) {
  if (!typeNode || depth > 5) return false;
  if (ts.isIndexedAccessTypeNode(typeNode)) {
    let root = typeNode.objectType;
    while (ts.isIndexedAccessTypeNode(root)) root = root.objectType;
    return (
      ts.isTypeReferenceNode(root) &&
      declarationsOf(checker, root.typeName).some((declaration) =>
        isContractFile(declaration.getSourceFile().fileName),
      )
    );
  }
  if (ts.isTypeReferenceNode(typeNode) && !typeNode.typeArguments) {
    const [alias] = declarationsOf(checker, typeNode.typeName);
    return (
      alias !== undefined &&
      ts.isTypeAliasDeclaration(alias) &&
      isContractLookup(checker, alias.type, depth + 1)
    );
  }
  return false;
}

/** True when every part of `type` is declared in the generated contract. */
function isContractType(checker, type) {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  if (type.isUnion() || type.isIntersection()) {
    return type.types.every((part) => isContractType(checker, part));
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker
      .getTypeArguments(type)
      .every((element) => isContractType(checker, element));
  }
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const declarations = symbol?.declarations ?? [];

  return (
    declarations.length > 0 &&
    declarations.every((declaration) =>
      isContractFile(declaration.getSourceFile().fileName),
    ) &&
    // A generic contract alias is only a contract type when its arguments are too.
    (type.aliasTypeArguments ?? []).every((argument) =>
      isContractType(checker, argument),
    )
  );
}

export const contractTypes = ESLintUtils.RuleCreator(
  () => 'docs/adr/004-frontend-architecture.md',
)({
  name: 'contract-types',
  meta: {
    type: 'problem',
    docs: {
      description:
        'The type argument of HttpClient methods and httpResource must be a type from @helmstead/api-contracts.',
    },
    messages: {
      missing:
        "Give {{call}} a type argument from @helmstead/api-contracts, e.g. {{call}}<components['schemas']['HealthResponse']>(…).",
      anyOrUnknown:
        '{{call}}<{{type}}> hides what the core returns. Use the type from @helmstead/api-contracts.',
      notContract:
        '{{call}}<{{type}}> is not a type from @helmstead/api-contracts. Use the generated contract type; map it to a model type after the call.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function check(node, call, signature) {
      const typeArgument = node.typeArguments?.params[0];
      if (!typeArgument) {
        // Only a JSON call needs one; text, blob and arrayBuffer responses have no type argument to give.
        const returned = checker.typeToString(signature.getReturnType());
        if (/<(Object|unknown)( \| undefined)?>/.test(returned)) {
          context.report({ node, messageId: 'missing', data: { call } });
        }
        return;
      }
      const type = services.getTypeAtLocation(typeArgument);
      const text = context.sourceCode.getText(typeArgument);
      if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        context.report({
          node: typeArgument,
          messageId: 'anyOrUnknown',
          data: { call, type: text },
        });
      } else if (
        // void: a response without content.
        !(type.flags & ts.TypeFlags.Void) &&
        !isContractType(checker, type) &&
        !isContractLookup(
          checker,
          services.esTreeNodeToTSNodeMap.get(typeArgument),
        )
      ) {
        context.report({
          node: typeArgument,
          messageId: 'notContract',
          data: { call, type: text },
        });
      }
    }

    return {
      CallExpression(node) {
        const signature = checker.getResolvedSignature(
          services.esTreeNodeToTSNodeMap.get(node),
        );
        const call = httpCallName(signature?.getDeclaration());
        if (call) check(node, call, signature);
      },
    };
  },
});

export default {
  meta: { name: 'helmstead' },
  rules: { 'contract-types': contractTypes },
};
