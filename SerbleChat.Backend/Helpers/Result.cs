namespace SerbleChat.Backend.Helpers;

public class Result<TR, TE> {
    private readonly TR _ok;
    private readonly TE _err;

    public bool IsOk { get; }
    public bool IsErr => !IsOk;

    private Result(TR ok) {
        _ok = ok;
        _err = default!;
        IsOk = true;
    }

    private Result(TE err) {
        _err = err;
        _ok = default!;
        IsOk = false;
    }

    public static Result<TR, TE> Ok(TR value) => new(value);
    public static Result<TR, TE> Err(TE error) => new(error);

    public TR Unwrap() =>
        IsOk ? _ok : throw new InvalidOperationException("Called Unwrap on Err");

    public TE UnwrapErr() =>
        IsErr ? _err : throw new InvalidOperationException("Called UnwrapErr on Ok");

    public bool GetResult(out TR result) {
        result = _ok;
        return IsErr;
    }
    
    public bool GetErr(out TE error) {
        error = _err;
        return IsErr;
    }
}