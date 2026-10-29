import { ESLintUtils } from '@typescript-eslint/utils';
import ts from 'typescript';

// Spec 002 criterion 8, docs/adr/004-frontend-architecture.md. A data-access lib types what the core returns with the
// types generated from the core's OpenAPI contract (libs/api-contracts), never with a hand-written copy. The check
// runs on the resolved type, not on the name written in the code, so an alias of a local interface, a local interface
// that extends a contract type, or an intersection with a local type all fail.

const CONTRACT_SOURCE = /[\\/]libs[\\/]api-contracts[\\/]src[\\/]/;
const HTTP_CLIENT_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'request',
  'jsonp',
]);

const isFromAngularHttp = (symbol) =>
  symbol?.declarations?.some((declaration) =>
    /[\\/]@angular[\\/]common[\\/]/.test(declaration.getSourceFile().fileName),
  ) ?? false;

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
      CONTRACT_SOURCE.test(declaration.getSourceFile().fileName),
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

    function check(node, call) {
      const typeArgument = node.typeArguments?.params[0];
      if (!typeArgument) {
        context.report({ node, messageId: 'missing', data: { call } });
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
      } else if (!isContractType(checker, type)) {
        context.report({
          node: typeArgument,
          messageId: 'notContract',
          data: { call, type: text },
        });
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;

        // httpResource<T>(…), and httpResource.text<T>(…) and friends.
        const resourceTarget =
          callee.type === 'MemberExpression' ? callee.object : callee;
        if (resourceTarget.type === 'Identifier') {
          const symbol = checker.getSymbolAtLocation(
            services.esTreeNodeToTSNodeMap.get(resourceTarget),
          );
          const resolved =
            symbol && symbol.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(symbol)
              : symbol;
          if (
            resolved?.name === 'httpResource' &&
            isFromAngularHttp(resolved)
          ) {
            check(node, context.sourceCode.getText(callee));
            return;
          }
        }

        // http.get<T>(…) where http is an HttpClient.
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          HTTP_CLIENT_METHODS.has(callee.property.name)
        ) {
          const objectType = services.getTypeAtLocation(callee.object);
          const symbol = objectType.getSymbol();
          if (symbol?.name === 'HttpClient' && isFromAngularHttp(symbol)) {
            check(node, `HttpClient.${callee.property.name}`);
          }
        }
      },
    };
  },
});

export default {
  meta: { name: 'helmstead' },
  rules: { 'contract-types': contractTypes },
};
