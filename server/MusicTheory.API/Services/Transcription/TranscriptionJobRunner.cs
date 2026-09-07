using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Hubs;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Drains the queue: decode, detect, store, tell whoever is listening.
/// </summary>
/// <remarks>
/// <para>
/// One item at a time, deliberately. Detection is 1.81 s of CPU for a
/// four-minute stem and it saturates the cores it runs on, so two at once would
/// make both slower and neither sooner. The bound that matters is arithmetic,
/// not concurrency, and when that stops being true this becomes several readers
/// rather than a different design.
/// </para>
/// <para>
/// <b>The database is the record and SignalR is a courtesy.</b> Every state
/// change is written before it is broadcast, so a client that is not connected —
/// or that connects late, or whose socket drops — loses a progress bar and
/// nothing else. That ordering is the whole reason a user can navigate away
/// mid-run.
/// </para>
/// </remarks>
public sealed class TranscriptionJobRunner(
    ITranscriptionQueue queue,
    IServiceScopeFactory scopeFactory,
    IHubContext<TranscriptionHub> hub,
    BasicPitchDetector detector,
    ILogger<TranscriptionJobRunner> logger) : BackgroundService
{
    /// <summary>
    /// How often progress is pushed, as a fraction of the whole.
    /// </summary>
    /// <remarks>
    /// The detector reports per window — 161 of them on a four-minute stem, over
    /// about two seconds. Forwarding every one is 80 messages a second to say
    /// something a person cannot read that fast.
    /// </remarks>
    private const double ProgressStep = 0.05;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var item in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await RunAsync(item, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Shutting down. The job stays Queued or Running in the
                // database, which is honest: nothing finished it.
                break;
            }
            catch (Exception ex)
            {
                // A failure here has already been recorded against the job by
                // RunAsync. Reaching this means the recording itself failed,
                // which must not take the runner down with it - one bad job
                // would otherwise stop every later one.
                logger.LogError(ex, "Transcription job {JobId} failed outside its own handler", item.JobId);
            }
            finally
            {
                Delete(item.AudioPath);
            }
        }
    }

    private async Task RunAsync(TranscriptionWorkItem item, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MusicTheoryDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IDetectionStore>();

        var job = await db.TranscriptionJobs.FirstOrDefaultAsync(j => j.Id == item.JobId, cancellationToken);
        if (job is null)
        {
            logger.LogWarning("Transcription job {JobId} vanished before it ran", item.JobId);
            return;
        }

        try
        {
            job.Status = TranscriptionJobStatus.Running;
            job.Progress = 0;
            await db.SaveChangesAsync(cancellationToken);
            await Send(item.JobId, "progress", 0d, cancellationToken);

            // Checked again here, not just at the controller: two uploads of the
            // same file can both miss the cache and both be queued, and the
            // second has no reason to re-run the model.
            if (await store.FindAsync(item.ContentHash, cancellationToken) is null)
            {
                await TranscribeAsync(item, store, cancellationToken);
            }
            else
            {
                logger.LogInformation(
                    "Transcription job {JobId} reused detections for {ContentHash}",
                    item.JobId,
                    item.ContentHash);
            }

            job.Status = TranscriptionJobStatus.Succeeded;
            job.Progress = 1;
            job.CompletedUtc = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);

            await Send(item.JobId, "completed", item.ContentHash, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Transcription job {JobId} failed", item.JobId);

            job.Status = TranscriptionJobStatus.Failed;
            job.CompletedUtc = DateTime.UtcNow;

            // The message a user sees. Decode failures are the common case and
            // say something actionable; everything else is deliberately vague,
            // because an exception message is not a user interface.
            job.Error = ex is NotSupportedException or ArgumentException
                ? ex.Message
                : "Transcription failed. The file may be corrupt or in an unsupported format.";

            await db.SaveChangesAsync(CancellationToken.None);
            await Send(item.JobId, "failed", job.Error, CancellationToken.None);
        }
    }

    private async Task TranscribeAsync(
        TranscriptionWorkItem item,
        IDetectionStore store,
        CancellationToken cancellationToken)
    {
        if (item.Separate)
        {
            // Reachable only if something sets the flag, which nothing does.
            // Loud rather than silently ignored: a user told the server to
            // separate and it did not.
            throw new NotSupportedException(
                "Source separation is not available: it is gated on a licensing "
                + "answer from Deezer about the Spleeter weights.");
        }

        await using var file = File.OpenRead(item.AudioPath);
        var decoded = AudioDecoder.DecodeToMono(file);

        var lastSent = 0d;
        var result = detector.Detect(
            decoded.Audio,
            DetectionFraming.DetectionSampleRate,
            fraction =>
            {
                if (fraction - lastSent < ProgressStep && fraction < 1)
                {
                    return;
                }

                lastSent = fraction;

                // Fire and forget: progress is a courtesy and the detector
                // should not wait on a socket to keep working. The database
                // carries the state that matters.
                _ = Send(item.JobId, "progress", fraction, CancellationToken.None);
            });

        await store.SaveAsync(
            item.ContentHash,
            result,
            decoded.DurationSec,
            fromSeparation: item.Separate,
            cancellationToken);
    }

    private Task Send(Guid jobId, string method, object payload, CancellationToken cancellationToken) =>
        hub.Clients.Group(TranscriptionHub.GroupFor(jobId))
            .SendAsync(method, jobId, payload, cancellationToken);

    private void Delete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException ex)
        {
            // The upload is scratch space, not the product. Failing to remove
            // it is worth knowing about and is not worth failing a finished
            // transcription over.
            logger.LogWarning(ex, "Could not delete spooled upload {Path}", path);
        }
    }
}
