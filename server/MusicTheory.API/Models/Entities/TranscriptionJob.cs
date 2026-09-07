using System.ComponentModel.DataAnnotations;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.Entities;

/// <summary>
/// One request to transcribe a file, and where it got to.
/// </summary>
/// <remarks>
/// <para>
/// The job exists so that a result survives the connection that asked for it.
/// Progress is streamed over SignalR while anyone is listening, but the job is
/// the record and the detections are the product: a user who navigates away
/// mid-run comes back to a finished row rather than to nothing, which is the
/// one genuinely new failure the design named.
/// </para>
/// <para>
/// <b>Owned by user id, not by connection.</b> An expired token resumes rather
/// than orphans, and one user cannot read another's job — even though the
/// detections it points at are shared, because what is shared is the audio's
/// content and not the fact that a particular person uploaded it.
/// </para>
/// </remarks>
public class TranscriptionJob
{
    [Key]
    public Guid Id { get; set; }

    /// <summary>Who asked. The only thing that authorises reading the result.</summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// SHA-256 of the uploaded file, and the key of the detections this
    /// produces or reuses.
    /// </summary>
    [MaxLength(64)]
    public string ContentHash { get; set; } = string.Empty;

    /// <summary>The uploaded file's name, for showing the user what this was.</summary>
    [MaxLength(260)]
    public string FileName { get; set; } = string.Empty;

    public TranscriptionJobStatus Status { get; set; }

    /// <summary>0-1. Meaningful only while <see cref="Status"/> is Running.</summary>
    public double Progress { get; set; }

    /// <summary>
    /// Why it failed, in terms a user can act on. Null unless
    /// <see cref="Status"/> is Failed.
    /// </summary>
    [MaxLength(500)]
    public string? Error { get; set; }

    public DateTime CreatedUtc { get; set; }

    public DateTime? CompletedUtc { get; set; }
}
