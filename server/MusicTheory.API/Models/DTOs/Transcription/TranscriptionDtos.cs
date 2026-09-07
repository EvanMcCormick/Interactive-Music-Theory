namespace MusicTheory.API.Models.DTOs.Transcription;

/// <summary>What <c>POST /api/transcriptions</c> returns.</summary>
/// <param name="JobId">Subscribe to this on the hub, and poll it on the API.</param>
/// <param name="ContentHash">
/// SHA-256 of the upload. Stable across users, so a client can tell that two
/// uploads are the same audio.
/// </param>
/// <param name="Status">
/// <c>Succeeded</c> already when the audio had been transcribed before — a
/// content-address hit, which is the common case for a class working through
/// one assignment.
/// </param>
public record CreateTranscriptionResponse(
    Guid JobId,
    string ContentHash,
    string Status);

/// <summary>
/// What <c>GET /api/transcriptions/{id}</c> returns.
/// </summary>
/// <remarks>
/// <c>DetectionResult</c> plus the duration and nothing else. Suppression, beat
/// tracking and derivation all stay client-side, so the server never learns
/// about tunings, capos or metrical levels — which is the tier line the whole
/// design is built on, expressed as a response shape.
/// </remarks>
public record TranscriptionResponse(
    Guid JobId,
    string Status,
    double Progress,
    string? Error,
    IReadOnlyList<DetectedNoteDto>? Notes,
    double? BendFrameRateHz,
    double? DurationSec);

/// <summary>One detected note, in the client's own shape.</summary>
public record DetectedNoteDto(
    string Id,
    int Pitch,
    double OnsetSec,
    double OffsetSec,
    double Confidence,
    IReadOnlyList<double> BendCents);
