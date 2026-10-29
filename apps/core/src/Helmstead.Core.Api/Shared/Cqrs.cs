using System.Reflection;

namespace Helmstead.Core.Api.Shared.Cqrs;

/// <summary>A request that changes state. Handled by exactly one <see cref="ICommandHandler{TCommand, TResult}"/>.</summary>
public interface ICommand<TResult>;

/// <summary>A request that only reads state. Handled by exactly one <see cref="IQueryHandler{TQuery, TResult}"/>.</summary>
public interface IQuery<TResult>;

public interface ICommandHandler<in TCommand, TResult>
    where TCommand : ICommand<TResult>
{
    Task<TResult> Handle(TCommand command, CancellationToken cancellationToken);
}

public interface IQueryHandler<in TQuery, TResult>
    where TQuery : IQuery<TResult>
{
    Task<TResult> Handle(TQuery query, CancellationToken cancellationToken);
}

public static class CqrsRegistration
{
    /// <summary>Registers every command and query handler of <paramref name="assembly"/> under its handler interface.</summary>
    public static IServiceCollection AddHandlers(this IServiceCollection services, Assembly assembly)
    {
        foreach (var type in assembly.GetTypes().Where(type => type is { IsClass: true, IsAbstract: false }))
        {
            foreach (var handler in type.GetInterfaces().Where(IsHandlerInterface))
            {
                services.AddScoped(handler, type);
            }
        }

        return services;
    }

    private static bool IsHandlerInterface(Type type) =>
        type.IsGenericType
        && type.GetGenericTypeDefinition() is var definition
        && (definition == typeof(ICommandHandler<,>) || definition == typeof(IQueryHandler<,>));
}
