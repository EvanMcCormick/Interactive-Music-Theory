using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace MusicTheory.API.Hubs;

/// <summary>
/// Progress for a running transcription.
/// </summary>
/// <remarks>
/// <para>
/// A client subscribes to one job by id and receives <c>progress</c> as
/// inference proceeds, then <c>completed</c> or <c>failed</c>. Nothing here
/// carries the result: the detections go to the database and the client fetches
/// them, because a user who closes the tab mid-run has to be able to come back
/// to a finished transcription rather than to a missed message.
/// </para>
/// <para>
/// <b>The hub is a convenience, not the contract.</b> Everything it sends is
/// also readable from <c>GET /api/transcriptions/{id}</c>, and a client that
/// never connects still gets its answer by polling. That is deliberate: a
/// dropped WebSocket should cost a user a progress bar, not a transcription.
/// </para>
/// </remarks>
[Authorize]
public class TranscriptionHub : Hub
{
    /// <summary>Path the client connects to.</summary>
    public const string Route = "/hubs/transcription";

    /// <summary>
    /// Starts receiving progress for one job.
    /// </summary>
    /// <remarks>
    /// Group membership is not an authorisation check and is not treated as
    /// one — the group name is a job id, which is a guess-resistant Guid, and
    /// the result itself is only reachable through the controller, which does
    /// check ownership. What a wrong subscription buys is somebody else's
    /// progress percentage.
    /// </remarks>
    public Task Subscribe(Guid jobId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(jobId));

    public Task Unsubscribe(Guid jobId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupFor(jobId));

    /// <summary>The group one job's messages go to.</summary>
    public static string GroupFor(Guid jobId) => $"transcription:{jobId}";
}
