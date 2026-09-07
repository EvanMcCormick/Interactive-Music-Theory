using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.Entities;

/// <summary>
/// What a detector observed for one piece of audio, keyed by the audio's own
/// bytes.
/// </summary>
/// <remarks>
/// <para>
/// <b>Detections are facts and are shared.</b> That is the two-layer model the
/// domain has had since M1 turned into a schema: nothing about tempo, meter,
/// key or instrument can make a <c>DetectedNote</c> wrong, so one row serves
/// every user who uploads the same bytes. A teacher assigning one riff to
/// thirty students is one inference run and one row, against thirty session
/// rows that each adjust tuning, capo and metrical level without touching
/// anyone else's.
/// </para>
/// <para>
/// The content hash does double duty: it dedups the compute, and it is the
/// foreign key. It also means a student re-uploading last week's track pays
/// nothing.
/// </para>
/// <para>
/// There is deliberately no user on this row. It records what the audio
/// contains, not who asked — which is also what makes sharing it between users
/// defensible, since the same bytes always produce the same answer.
/// </para>
/// </remarks>
public class TranscriptionDetections
{
    /// <summary>
    /// SHA-256 of the uploaded file, lowercase hex. 64 characters.
    /// </summary>
    [Key]
    [MaxLength(64)]
    public string ContentHash { get; set; } = string.Empty;

    /// <summary>
    /// The detected notes as gzipped JSON.
    /// </summary>
    /// <remarks>
    /// This is the bulk of the row and the one thing that must persist: it is
    /// what makes re-derivation possible tomorrow without re-uploading. A
    /// four-minute stem is 1,224 detections with <c>bendCents</c> dominating at
    /// roughly 30 values a note, which is megabytes as JSON and a fraction of
    /// that compressed.
    /// </remarks>
    public byte[] RawNotes { get; set; } = [];

    /// <summary>Frame rate of every note's <c>bendCents</c>, in Hz.</summary>
    /// <remarks>
    /// Stored rather than assumed: a bend array is useless without its rate,
    /// and a future detector may not report at 86.13 Hz. Reading it off a
    /// constant would silently misplace every bend in an old row.
    /// </remarks>
    public double BendFrameRateHz { get; set; }

    /// <summary>Length of the decoded audio, in seconds.</summary>
    public double DurationSec { get; set; }

    /// <summary>Notes in <see cref="RawNotes"/>, denormalised for reporting.</summary>
    public int NoteCount { get; set; }

    /// <summary>
    /// Whether these came from separated audio rather than a clean stem.
    /// </summary>
    /// <remarks>
    /// A field now rather than an awkward migration later, and it is not
    /// cosmetic. Separation costs 18 points of F1 and <em>all of it is
    /// precision</em> — recall rises 68.8 to 74.7 % — so separated input wants a
    /// different default <c>confidenceFloor</c> than a clean stem, with 5.9
    /// points of recall headroom to spend buying precision back. Nothing reads
    /// it yet because separation is still gated on the Spleeter licence.
    /// </remarks>
    public bool FromSeparation { get; set; }

    public DateTime CreatedUtc { get; set; }
}
