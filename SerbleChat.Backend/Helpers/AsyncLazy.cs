namespace SerbleChat.Backend.Helpers;

public class AsyncLazy<T> {
    private readonly Lazy<Task<T>> _instance;

    public AsyncLazy(Func<Task<T>> factory) {
        ArgumentNullException.ThrowIfNull(factory);
        _instance = new Lazy<Task<T>>(() => Task.Run(factory));
    }

    public Task<T> Value => _instance.Value;
}
