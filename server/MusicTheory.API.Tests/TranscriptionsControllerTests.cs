using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using MusicTheory.API.Controllers;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.Transcription;
using MusicTheory.API.Models.Entities;
using MusicTheory.API.Models.Enums;
using MusicTheory.API.Services.Transcription;

namespace MusicTheory.API.Tests;

/// <summary>
/// The endpoints, the content-addressing, and who is allowed to read what.
/// </summary>
/// <remarks>
/// Built by hand against an in-memory context rather than through
/// <c>WebApplicationFactory</c>. What is worth testing here is this
/// controller's own decisions — the cache hit, the ownership check, the
/// validation — and none of them needs a server, a JWT or a socket to exercise.
/// The pipeline it hands work to is tested at length elsewhere.
/// </remarks>
public class TranscriptionsControllerTests
{
    private static readonly Guid Alice = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Bob = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task Upload_queues_a_job_and_returns_its_id()
    {
        await using var db = NewContext();
        var queue = new TranscriptionQueue();
        var controller = NewController(db, queue, Alice);

        var result = await controller.Create(FileOf("hello audio", "riff.mp3"));

        var accepted = Assert.IsType<AcceptedResult>(result.Result);
        var body = Assert.IsType<CreateTranscriptionResponse>(accepted.Value);

        Assert.Equal(nameof(TranscriptionJobStatus.Queued), body.Status);
        Assert.Equal(1, queue.Count);

        var job = await db.TranscriptionJobs.SingleAsync();
        Assert.Equal(Alice, job.UserId);
        Assert.Equal("riff.mp3", job.FileName);
        Assert.Equal(body.ContentHash, job.ContentHash);
    }

    /// <summary>
    /// The property the whole content-addressing scheme exists for.
    /// </summary>
    /// <remarks>
    /// A teacher assigns one riff to thirty students. That has to be one
    /// inference run and thirty rows pointing at it, not thirty runs — which is
    /// the difference between a cost model that works and one that does not.
    /// </remarks>
    [Fact]
    public async Task A_file_transcribed_before_is_not_transcribed_again()
    {
        await using var db = NewContext();
        var queue = new TranscriptionQueue();

        var first = await NewController(db, queue, Alice).Create(FileOf("same bytes", "riff.mp3"));
        var firstBody = Body(first);

        // Somebody else, same audio.
        await Store(db).SaveAsync(firstBody.ContentHash, SomeNotes(), 12.5, fromSeparation: false);

        var second = await NewController(db, queue, Bob).Create(FileOf("same bytes", "riff.mp3"));
        var secondBody = Body(second);

        Assert.Equal(firstBody.ContentHash, secondBody.ContentHash);
        Assert.Equal(nameof(TranscriptionJobStatus.Succeeded), secondBody.Status);

        // Only the first upload was queued.
        Assert.Equal(1, queue.Count);
        Assert.Equal(2, await db.TranscriptionJobs.CountAsync());
    }

    [Fact]
    public async Task Different_audio_gets_a_different_hash()
    {
        await using var db = NewContext();
        var queue = new TranscriptionQueue();

        var one = Body(await NewController(db, queue, Alice).Create(FileOf("first", "a.mp3")));
        var two = Body(await NewController(db, queue, Alice).Create(FileOf("second", "b.mp3")));

        Assert.NotEqual(one.ContentHash, two.ContentHash);
    }

    [Fact]
    public async Task Rejects_an_empty_upload()
    {
        await using var db = NewContext();
        var controller = NewController(db, new TranscriptionQueue(), Alice);

        var result = await controller.Create(FileOf("", "empty.mp3"));

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Rejects_a_separation_request_while_the_licence_is_unresolved()
    {
        await using var db = NewContext();
        var controller = NewController(db, new TranscriptionQueue(), Alice);

        var result = await controller.Create(FileOf("audio", "riff.mp3"), separate: true);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("Spleeter", bad.Value!.ToString());
    }

    [Fact]
    public async Task Returns_progress_while_a_job_is_running()
    {
        await using var db = NewContext();
        var job = await AddJob(db, Alice, "abc", TranscriptionJobStatus.Running, progress: 0.4);

        var result = await NewController(db, new TranscriptionQueue(), Alice).Get(job.Id);

        var body = Assert.IsType<TranscriptionResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(nameof(TranscriptionJobStatus.Running), body.Status);
        Assert.Equal(0.4, body.Progress);
        Assert.Null(body.Notes);
    }

    [Fact]
    public async Task Returns_the_detections_once_the_job_has_finished()
    {
        await using var db = NewContext();
        const string hash = "deadbeef";

        await Store(db).SaveAsync(hash, SomeNotes(), 12.5, fromSeparation: false);
        var job = await AddJob(db, Alice, hash, TranscriptionJobStatus.Succeeded, progress: 1);

        var result = await NewController(db, new TranscriptionQueue(), Alice).Get(job.Id);
        var body = Assert.IsType<TranscriptionResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

        Assert.Equal(nameof(TranscriptionJobStatus.Succeeded), body.Status);
        Assert.Equal(12.5, body.DurationSec);
        Assert.Equal(BasicPitchDetector.BendFrameRateHz, body.BendFrameRateHz);

        Assert.NotNull(body.Notes);
        Assert.Equal(2, body.Notes!.Count);
        Assert.Equal(45, body.Notes[0].Pitch);
        Assert.Equal([0.0, 33.33, -66.67], body.Notes[0].BendCents);
    }

    /// <summary>
    /// Detections are shared; the fact that a particular person uploaded
    /// something is not.
    /// </summary>
    /// <remarks>
    /// Not found rather than forbidden, deliberately: whether a given job id
    /// exists is not something an unrelated user needs to learn.
    /// </remarks>
    [Fact]
    public async Task One_user_cannot_read_another_users_job()
    {
        await using var db = NewContext();
        var job = await AddJob(db, Alice, "abc", TranscriptionJobStatus.Succeeded, progress: 1);

        var result = await NewController(db, new TranscriptionQueue(), Bob).Get(job.Id);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task An_unknown_job_is_not_found()
    {
        await using var db = NewContext();

        var result = await NewController(db, new TranscriptionQueue(), Alice).Get(Guid.NewGuid());

        Assert.IsType<NotFoundResult>(result.Result);
    }

    /// <summary>
    /// A job that says it succeeded but whose detections are gone is an error,
    /// not an empty transcription.
    /// </summary>
    [Fact]
    public async Task A_succeeded_job_with_no_detections_is_not_found()
    {
        await using var db = NewContext();
        var job = await AddJob(db, Alice, "missing", TranscriptionJobStatus.Succeeded, progress: 1);

        var result = await NewController(db, new TranscriptionQueue(), Alice).Get(job.Id);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401()
    {
        await using var db = NewContext();
        var controller = NewController(db, new TranscriptionQueue(), userId: null);

        Assert.IsType<UnauthorizedResult>((await controller.Create(FileOf("a", "a.mp3"))).Result);
        Assert.IsType<UnauthorizedResult>((await controller.Get(Guid.NewGuid())).Result);
    }

    // ----- helpers -----

    private static MusicTheoryDbContext NewContext() =>
        new(new DbContextOptionsBuilder<MusicTheoryDbContext>()
            .UseInMemoryDatabase($"transcriptions-{Guid.NewGuid()}")
            .Options);

    private static DetectionStore Store(MusicTheoryDbContext db) => new(db);

    private static TranscriptionsController NewController(
        MusicTheoryDbContext db,
        ITranscriptionQueue queue,
        Guid? userId)
    {
        var identity = userId is null
            ? new ClaimsIdentity()
            : new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString())], "test");

        return new TranscriptionsController(
            db,
            Store(db),
            queue,
            NullLogger<TranscriptionsController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            },

            // The 202's Location header goes through IUrlHelper, which a
            // hand-built controller has no routing to supply. Stubbed rather
            // than removed from the endpoint: telling a client where to poll is
            // worth a header, and worth more than the convenience of a
            // controller that constructs with nothing.
            Url = new StubUrlHelper()
        };
    }

    private sealed class StubUrlHelper : IUrlHelper
    {
        public ActionContext ActionContext { get; } = new();

        public string Action(UrlActionContext actionContext) => "/api/transcriptions/stub";

        public string? Content(string? contentPath) => contentPath;

        public bool IsLocalUrl(string? url) => true;

        public string? Link(string? routeName, object? values) => null;

        public string? RouteUrl(UrlRouteContext routeContext) => null;
    }

    private static async Task<TranscriptionJob> AddJob(
        MusicTheoryDbContext db,
        Guid userId,
        string contentHash,
        TranscriptionJobStatus status,
        double progress)
    {
        var job = new TranscriptionJob
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            ContentHash = contentHash,
            FileName = "riff.mp3",
            Status = status,
            Progress = progress,
            CreatedUtc = DateTime.UtcNow
        };

        db.TranscriptionJobs.Add(job);
        await db.SaveChangesAsync();
        return job;
    }

    private static CreateTranscriptionResponse Body(ActionResult<CreateTranscriptionResponse> result) =>
        Assert.IsType<CreateTranscriptionResponse>(Assert.IsType<AcceptedResult>(result.Result).Value);

    private static IFormFile FileOf(string content, string fileName)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
    }

    private static DetectionResult SomeNotes() =>
        new(
        [
            new DetectedNote
            {
                Id = "bp-0",
                Pitch = 45,
                OnsetSec = 0.5,
                OffsetSec = 1.25,
                Confidence = 0.81,
                BendCents = [0.0, 33.33, -66.67]
            },
            new DetectedNote
            {
                Id = "bp-1",
                Pitch = 52,
                OnsetSec = 1.5,
                OffsetSec = 2.0,
                Confidence = 0.62,
                BendCents = []
            }
        ],
        BasicPitchDetector.BendFrameRateHz);
}
