namespace MusicTheory.API.Models.Enums;

/// <summary>Where a transcription job has got to.</summary>
public enum TranscriptionJobStatus
{
    /// <summary>Accepted and waiting for the queue.</summary>
    Queued = 0,

    /// <summary>Being decoded or run through the model.</summary>
    Running = 1,

    /// <summary>
    /// Finished. The detections are stored under the job's content hash.
    /// </summary>
    Succeeded = 2,

    /// <summary>Finished badly. <c>Error</c> says how.</summary>
    Failed = 3
}
