using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Services.Transcription;

namespace MusicTheory.API.Tests;

/// <summary>
/// The compressed round trip, which is where detections would be silently
/// corrupted rather than lost.
/// </summary>
/// <remarks>
/// A row that fails to save is obvious. A row that saves and comes back with
/// bends truncated, or with a double rounded on the way through JSON, is not:
/// it would surface weeks later as a bend that does not match the audio, long
/// after anyone would think to look here. So the assertions are exact.
/// </remarks>
public class DetectionStoreTests
{
    [Fact]
    public async Task Notes_survive_the_round_trip_exactly()
    {
        await using var db = NewContext();
        var store = new DetectionStore(db);

        var notes = new List<DetectedNote>
        {
            new()
            {
                Id = "bp-0",
                Pitch = 27,
                OnsetSec = 0.011609977324263039,
                OffsetSec = 1.9853061224489796,
                Confidence = 0.7630356648799346,
                // Thirty values, as a real note carries, including the
                // repeated zeros a run-length-naive format would mangle.
                BendCents = [.. Enumerable.Range(0, 30).Select(i => (i % 7 - 3) * 100.0 / 3)]
            },
            new()
            {
                Id = "bp-1",
                Pitch = 108,
                OnsetSec = 261.02116145124717,
                OffsetSec = 262.5712,
                Confidence = 0.30000000000000004,
                BendCents = []
            }
        };

        await store.SaveAsync("abc123", new DetectionResult(notes, 86.1328125), 262.5712, false);

        var row = await store.FindAsync("abc123");
        Assert.NotNull(row);

        var read = store.ReadNotes(row!);
        Assert.Equal(notes.Count, read.Count);

        for (var i = 0; i < notes.Count; i++)
        {
            Assert.Equal(notes[i].Id, read[i].Id);
            Assert.Equal(notes[i].Pitch, read[i].Pitch);
            Assert.True(notes[i].OnsetSec.Equals(read[i].OnsetSec), $"note {i} onset");
            Assert.True(notes[i].OffsetSec.Equals(read[i].OffsetSec), $"note {i} offset");
            Assert.True(notes[i].Confidence.Equals(read[i].Confidence), $"note {i} confidence");
            Assert.Equal(notes[i].BendCents, read[i].BendCents);
        }

        Assert.Equal(86.1328125, row!.BendFrameRateHz);
        Assert.Equal(262.5712, row.DurationSec);
        Assert.Equal(2, row.NoteCount);
        Assert.False(row.FromSeparation);
    }

    [Fact]
    public async Task Compression_earns_its_place()
    {
        await using var db = NewContext();
        var store = new DetectionStore(db);

        // A stem's worth: 1,224 notes with thirty bend values each, which is
        // what the real capture holds.
        var notes = Enumerable.Range(0, 1224).Select(i => new DetectedNote
        {
            Id = $"bp-{i}",
            Pitch = 28 + i % 40,
            OnsetSec = i * 0.2143,
            OffsetSec = i * 0.2143 + 0.39,
            Confidence = 0.5 + i % 100 / 400.0,
            BendCents = [.. Enumerable.Range(0, 30).Select(b => (b % 5 - 2) * 100.0 / 3)]
        }).ToList();

        await store.SaveAsync("stem", new DetectionResult(notes, 86.1328125), 262.5, false);

        var row = await store.FindAsync("stem");
        Assert.Equal(1224, store.ReadNotes(row!).Count);

        // Not a threshold anyone tuned - just the assertion that gzipping a
        // megabyte of repetitive JSON does what gzip does, so that a future
        // change to the stored shape has to notice if it stops.
        Assert.True(
            row!.RawNotes.Length < 200_000,
            $"1,224 notes compressed to {row.RawNotes.Length} bytes, which is larger "
            + "than the format should need");
    }

    /// <summary>
    /// Two users can upload the same file at once. The loser of that race has
    /// produced identical detections by definition, so the row is left alone
    /// rather than rewritten.
    /// </summary>
    [Fact]
    public async Task Saving_twice_keeps_the_first_row()
    {
        await using var db = NewContext();
        var store = new DetectionStore(db);

        await store.SaveAsync("abc", Result(45), 10, false);
        await store.SaveAsync("abc", Result(52), 10, false);

        var row = await store.FindAsync("abc");
        Assert.Equal(45, store.ReadNotes(row!).Single().Pitch);
        Assert.Equal(1, await db.TranscriptionDetections.CountAsync());
    }

    [Fact]
    public async Task Audio_never_seen_before_has_no_detections()
    {
        await using var db = NewContext();

        Assert.Null(await new DetectionStore(db).FindAsync("nothing-here"));
    }

    private static MusicTheoryDbContext NewContext() =>
        new(new DbContextOptionsBuilder<MusicTheoryDbContext>()
            .UseInMemoryDatabase($"detections-{Guid.NewGuid()}")
            .Options);

    private static DetectionResult Result(int pitch) =>
        new(
        [
            new DetectedNote
            {
                Id = "bp-0",
                Pitch = pitch,
                OnsetSec = 0,
                OffsetSec = 1,
                Confidence = 0.5,
                BendCents = []
            }
        ],
        86.1328125);
}
