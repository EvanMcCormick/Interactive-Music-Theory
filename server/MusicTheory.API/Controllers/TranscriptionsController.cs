using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.Transcription;
using MusicTheory.API.Models.Entities;
using MusicTheory.API.Models.Enums;
using MusicTheory.API.Services.Transcription;

namespace MusicTheory.API.Controllers;

/// <summary>
/// Server-side transcription: the paid tier's half of the
/// <c>NoteDetector</c> interface.
/// </summary>
/// <remarks>
/// <para>
/// Two endpoints and a hub. <c>POST</c> takes the file and returns a job;
/// <c>GET</c> returns progress and, once there is one, the result. The response
/// is <c>DetectionResult</c> plus a duration and nothing else — suppression,
/// beat tracking and derivation stay in the browser in both tiers, so this
/// never learns about tunings, capos or metrical levels.
/// </para>
/// <para>
/// <b>The original file crosses the wire, not decoded samples.</b> The decoded
/// form is larger: a 4:22 stem is 10 MB as MP3 and 23 MB as mono float32 at
/// 22.05 kHz.
/// </para>
/// <para>
/// <b>Uploads are content-addressed.</b> A teacher assigning one riff to thirty
/// students is one inference run and thirty jobs pointing at one row, and a
/// student re-uploading last week's track pays nothing. The hash is of the
/// bytes, so it is stable across users and across sessions.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TranscriptionsController(
    MusicTheoryDbContext db,
    IDetectionStore store,
    ITranscriptionQueue queue,
    ILogger<TranscriptionsController> logger) : ControllerBase
{
    /// <summary>
    /// Largest upload accepted, in bytes.
    /// </summary>
    /// <remarks>
    /// 50 MB is a long lossless stem and several times a long MP3. The client
    /// rejects oversized files before the bytes move; this is the check that
    /// does not trust it.
    /// </remarks>
    public const long MaxUploadBytes = 50L * 1024 * 1024;

    /// <summary>Accepts audio for transcription.</summary>
    [HttpPost]
    [RequestSizeLimit(MaxUploadBytes)]
    [ProducesResponseType(typeof(CreateTranscriptionResponse), StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CreateTranscriptionResponse>> Create(
        IFormFile file,
        [FromForm] bool separate = false,
        CancellationToken cancellationToken = default)
    {
        var userId = GetCurrentUserId();
        if (userId is null)
        {
            return Unauthorized();
        }

        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "No audio was uploaded." });
        }

        if (file.Length > MaxUploadBytes)
        {
            return BadRequest(new
            {
                error = $"Audio is larger than the {MaxUploadBytes / (1024 * 1024)} MB limit."
            });
        }

        if (separate)
        {
            return BadRequest(new
            {
                error = "Source separation is not available: it is gated on a licensing "
                        + "answer from Deezer about the Spleeter weights."
            });
        }

        // Spooled to disk rather than held in memory: the runner is on another
        // thread and may not start for a while, and a queue's worth of 50 MB
        // uploads in memory is a way to fall over under exactly the load the
        // queue exists to absorb.
        var spoolPath = Path.Combine(Path.GetTempPath(), $"transcription-{Guid.NewGuid():N}");
        string contentHash;

        try
        {
            await using (var spool = System.IO.File.Create(spoolPath))
            {
                await file.CopyToAsync(spool, cancellationToken);
            }

            contentHash = await HashAsync(spoolPath, cancellationToken);
        }
        catch
        {
            Delete(spoolPath);
            throw;
        }

        var job = new TranscriptionJob
        {
            Id = Guid.NewGuid(),
            UserId = userId.Value,
            ContentHash = contentHash,
            FileName = Path.GetFileName(file.FileName) ?? string.Empty,
            Status = TranscriptionJobStatus.Queued,
            CreatedUtc = DateTime.UtcNow
        };

        // The content-address hit. Thirty students on one assignment reach this
        // and never touch the model.
        var existing = await store.FindAsync(contentHash, cancellationToken);
        if (existing is not null)
        {
            job.Status = TranscriptionJobStatus.Succeeded;
            job.Progress = 1;
            job.CompletedUtc = job.CreatedUtc;
            Delete(spoolPath);

            logger.LogInformation(
                "Transcription {JobId} served from cache for {ContentHash}",
                job.Id,
                contentHash);
        }

        db.TranscriptionJobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);

        if (existing is null)
        {
            await queue.EnqueueAsync(
                new TranscriptionWorkItem(job.Id, contentHash, spoolPath, separate),
                cancellationToken);
        }

        var response = new CreateTranscriptionResponse(job.Id, contentHash, job.Status.ToString());

        // 202 even for a cache hit, so a client has one path rather than two.
        // The status in the body says it is already done and the client can go
        // straight to GET without waiting on the hub.
        return Accepted(Url.Action(nameof(Get), new { id = job.Id }), response);
    }

    /// <summary>Progress, and the detections once there are any.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(TranscriptionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TranscriptionResponse>> Get(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var userId = GetCurrentUserId();
        if (userId is null)
        {
            return Unauthorized();
        }

        var job = await db.TranscriptionJobs
            .AsNoTracking()
            .FirstOrDefaultAsync(j => j.Id == id, cancellationToken);

        // Not found rather than forbidden for someone else's job: whether a
        // given job id exists is not something an unrelated user needs to learn.
        if (job is null || job.UserId != userId.Value)
        {
            return NotFound();
        }

        if (job.Status != TranscriptionJobStatus.Succeeded)
        {
            return Ok(new TranscriptionResponse(
                job.Id,
                job.Status.ToString(),
                job.Progress,
                job.Error,
                Notes: null,
                BendFrameRateHz: null,
                DurationSec: null));
        }

        var detections = await store.FindAsync(job.ContentHash, cancellationToken);
        if (detections is null)
        {
            // Succeeded with nothing to show: the detections row was removed
            // under it. Reporting success with no notes would look like a
            // silent transcription of nothing.
            logger.LogError(
                "Transcription {JobId} succeeded but {ContentHash} has no detections",
                job.Id,
                job.ContentHash);
            return NotFound();
        }

        var notes = store.ReadNotes(detections)
            .Select(n => new DetectedNoteDto(
                n.Id,
                n.Pitch,
                n.OnsetSec,
                n.OffsetSec,
                n.Confidence,
                n.BendCents))
            .ToList();

        return Ok(new TranscriptionResponse(
            job.Id,
            job.Status.ToString(),
            1,
            null,
            notes,
            detections.BendFrameRateHz,
            detections.DurationSec));
    }

    /// <summary>SHA-256 of the spooled upload, lowercase hex.</summary>
    /// <remarks>
    /// Streamed from disk rather than hashed in memory, for the same reason the
    /// upload was spooled there.
    /// </remarks>
    private static async Task<string> HashAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexStringLower(hash);
    }

    private static void Delete(string path)
    {
        try
        {
            if (System.IO.File.Exists(path))
            {
                System.IO.File.Delete(path);
            }
        }
        catch (IOException)
        {
            // Scratch space. The runner deletes it too, and a leftover file in
            // the temp directory is not worth failing a request over.
        }
    }

    private Guid? GetCurrentUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        return Guid.TryParse(userIdClaim, out var userId) ? userId : null;
    }
}
