using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services.Transcription;

/// <summary>Reads and writes the shared, content-addressed detections.</summary>
public interface IDetectionStore
{
    /// <summary>What was detected for these bytes before, if anything.</summary>
    Task<TranscriptionDetections?> FindAsync(
        string contentHash,
        CancellationToken cancellationToken = default);

    Task SaveAsync(
        string contentHash,
        DetectionResult result,
        double durationSec,
        bool fromSeparation,
        CancellationToken cancellationToken = default);

    /// <summary>Unpacks a stored row back into notes.</summary>
    IReadOnlyList<DetectedNote> ReadNotes(TranscriptionDetections row);
}

/// <summary>
/// The detections table, with the compression the design specified.
/// </summary>
/// <remarks>
/// <para>
/// <c>rawNotes</c> is the bulk of a row — 1,224 detections on a four-minute
/// stem, <c>bendCents</c> dominating at roughly 30 values a note — and it is
/// the one thing that must persist, because it is what makes re-derivation
/// possible tomorrow without re-uploading. JSON is the natural shape for it and
/// a poor one to store, so it is gzipped: the arrays are long runs of small
/// numbers and compress hard.
/// </para>
/// <para>
/// Serialised through an explicit DTO rather than the domain record, so that
/// renaming a C# property does not silently orphan every row written before the
/// rename. The names here are the client's, which is also what crosses the
/// wire.
/// </para>
/// </remarks>
public sealed class DetectionStore(MusicTheoryDbContext db) : IDetectionStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public Task<TranscriptionDetections?> FindAsync(
        string contentHash,
        CancellationToken cancellationToken = default) =>
        db.TranscriptionDetections
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.ContentHash == contentHash, cancellationToken);

    public async Task SaveAsync(
        string contentHash,
        DetectionResult result,
        double durationSec,
        bool fromSeparation,
        CancellationToken cancellationToken = default)
    {
        // Two users can upload the same file at once, and the loser of that
        // race has produced identical detections by definition - the hash is of
        // the bytes the model read. So an existing row is left alone rather
        // than overwritten.
        var existing = await db.TranscriptionDetections
            .FirstOrDefaultAsync(d => d.ContentHash == contentHash, cancellationToken);
        if (existing is not null)
        {
            return;
        }

        db.TranscriptionDetections.Add(new TranscriptionDetections
        {
            ContentHash = contentHash,
            RawNotes = Compress(result.Notes),
            BendFrameRateHz = result.BendFrameRateHz,
            DurationSec = durationSec,
            NoteCount = result.Notes.Count,
            FromSeparation = fromSeparation,
            CreatedUtc = DateTime.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    public IReadOnlyList<DetectedNote> ReadNotes(TranscriptionDetections row)
    {
        ArgumentNullException.ThrowIfNull(row);

        using var compressed = new MemoryStream(row.RawNotes);
        using var gzip = new GZipStream(compressed, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);

        var stored = JsonSerializer.Deserialize<StoredNote[]>(reader.ReadToEnd(), Json) ?? [];

        return stored.Select(n => new DetectedNote
        {
            Id = n.Id,
            Pitch = n.Pitch,
            OnsetSec = n.OnsetSec,
            OffsetSec = n.OffsetSec,
            Confidence = n.Confidence,
            BendCents = n.BendCents
        }).ToList();
    }

    private static byte[] Compress(IReadOnlyList<DetectedNote> notes)
    {
        var stored = notes.Select(n => new StoredNote
        {
            Id = n.Id,
            Pitch = n.Pitch,
            OnsetSec = n.OnsetSec,
            OffsetSec = n.OffsetSec,
            Confidence = n.Confidence,
            BendCents = [.. n.BendCents]
        }).ToArray();

        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            JsonSerializer.Serialize(gzip, stored, Json);
        }

        return output.ToArray();
    }

    /// <summary>
    /// The on-disk shape, pinned independently of the domain record.
    /// </summary>
    private sealed class StoredNote
    {
        public string Id { get; set; } = string.Empty;
        public int Pitch { get; set; }
        public double OnsetSec { get; set; }
        public double OffsetSec { get; set; }
        public double Confidence { get; set; }
        public double[] BendCents { get; set; } = [];
    }
}
