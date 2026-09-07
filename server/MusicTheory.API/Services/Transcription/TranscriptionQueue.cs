using System.Threading.Channels;

namespace MusicTheory.API.Services.Transcription;

/// <summary>One accepted upload, waiting to be transcribed.</summary>
/// <param name="JobId">The job row this will update.</param>
/// <param name="ContentHash">SHA-256 of the audio, and the detections' key.</param>
/// <param name="AudioPath">
/// Where the bytes were spooled. The runner deletes this when it is done.
/// </param>
/// <param name="Separate">
/// Run separation before detection. Ignored until the Spleeter licence clears;
/// carried now so the contract does not change when it does.
/// </param>
public readonly record struct TranscriptionWorkItem(
    Guid JobId,
    string ContentHash,
    string AudioPath,
    bool Separate);

/// <summary>The handover between a request and the worker that serves it.</summary>
public interface ITranscriptionQueue
{
    ValueTask EnqueueAsync(TranscriptionWorkItem item, CancellationToken cancellationToken = default);

    IAsyncEnumerable<TranscriptionWorkItem> ReadAllAsync(CancellationToken cancellationToken);

    /// <summary>How many items are waiting. For tests and for reporting.</summary>
    int Count { get; }
}

/// <summary>
/// A bounded in-memory queue.
/// </summary>
/// <remarks>
/// <para>
/// <b>In-memory, and that is a real limit worth stating.</b> A restart loses
/// whatever was queued: those jobs stay <c>Queued</c> in the database forever
/// and no one transcribes them. That is survivable now — one process, one
/// machine, jobs that take under two seconds — and it is the first thing to
/// replace when there is more than one server, at which point the queue becomes
/// a table or a broker and this type goes away. It is written as an interface
/// so that replacement touches one registration.
/// </para>
/// <para>
/// Bounded rather than unbounded, and it waits rather than dropping. An
/// unbounded queue turns a burst of uploads into a memory problem that shows up
/// as something else entirely; a full queue instead makes the request that
/// would have overfilled it wait for room, which is backpressure the caller can
/// see.
/// </para>
/// </remarks>
public sealed class TranscriptionQueue : ITranscriptionQueue
{
    /// <summary>
    /// Deep enough that a class submitting together does not queue behind
    /// itself, shallow enough that a runaway is visible.
    /// </summary>
    public const int Capacity = 64;

    private readonly Channel<TranscriptionWorkItem> _channel =
        Channel.CreateBounded<TranscriptionWorkItem>(
            new BoundedChannelOptions(Capacity)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = true
            });

    public int Count => _channel.Reader.Count;

    public ValueTask EnqueueAsync(
        TranscriptionWorkItem item,
        CancellationToken cancellationToken = default) =>
        _channel.Writer.WriteAsync(item, cancellationToken);

    public IAsyncEnumerable<TranscriptionWorkItem> ReadAllAsync(
        CancellationToken cancellationToken) =>
        _channel.Reader.ReadAllAsync(cancellationToken);
}
