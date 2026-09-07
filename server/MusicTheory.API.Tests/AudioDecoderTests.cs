using MusicTheory.API.Services.Transcription;
using NAudio.Utils;
using NAudio.Wave;
using Xunit.Abstractions;

namespace MusicTheory.API.Tests;

/// <summary>
/// The decoder, and mostly the resampler inside it.
/// </summary>
/// <remarks>
/// <c>audio-decode.ts</c> records the measurement these exist to protect: a
/// rate conversion done by interpolation without a low-pass leaves a 15 kHz
/// tone at <b>0.41 RMS</b> after 44.1 kHz to 22.05 kHz, mirrored down to 7 kHz
/// at near full strength, against 0.00006 when the conversion is band-limited.
/// Everything above the new Nyquist folds back into the band, and a pitch
/// detector fed that invents notes out of the reflections. It is the kind of
/// bug that produces plausible output, so it is asserted rather than assumed.
/// </remarks>
public class AudioDecoderTests(ITestOutputHelper output)
{
    private const int TargetRate = DetectionFraming.DetectionSampleRate;

    [Fact]
    public void Decodes_a_wav_to_mono_at_the_detector_rate()
    {
        var wav = WriteWav(Tone(44100, 2.0, 440, 0.5), 44100, channels: 1);

        var decoded = AudioDecoder.DecodeToMono(wav);

        Assert.Equal(44100, decoded.SourceSampleRate);
        Assert.Equal(1, decoded.SourceChannels);

        // Two seconds at the target rate, give or take the resampler's tail.
        Assert.InRange(decoded.Audio.Length, TargetRate * 2 - 200, TargetRate * 2 + 200);
        Assert.InRange(decoded.DurationSec, 1.98, 2.02);
    }

    /// <summary>
    /// The measurement the module exists for.
    /// </summary>
    /// <remarks>
    /// 15 kHz is well above the 11.025 kHz Nyquist of the target rate, so a
    /// band-limited resampler removes it. An interpolating one mirrors it to
    /// 7.05 kHz, inside a bass's harmonic range, where the detector would read
    /// it as a note.
    /// </remarks>
    [Fact]
    public void Resampling_removes_content_above_the_new_Nyquist()
    {
        var wav = WriteWav(Tone(44100, 2.0, 15000, 1.0), 44100, channels: 1);

        var decoded = AudioDecoder.DecodeToMono(wav);
        var rms = Rms(decoded.Audio);

        output.WriteLine($"15 kHz tone after 44.1k -> 22.05k: {rms:F6} RMS");

        // Measured at 0.00092 with sinc on. The threshold sits below NAudio's
        // own WdlResamplingSampleProvider, which measures 0.0085 with sinc off,
        // so this fails if the resampler is quietly swapped for that one - and
        // far below the 0.41 the client measured for the interpolating path.
        Assert.True(
            rms < 0.005,
            $"15 kHz survived resampling at {rms:F6} RMS, against 0.00092 measured. "
            + "At 0.0085 the sinc filter has been turned off; at 0.41 the resampler "
            + "is interpolating, and the tone has landed at 7 kHz where the detector "
            + "will read it as a note.");
    }

    /// <summary>
    /// The other half, without which the test above passes for a decoder that
    /// returns silence.
    /// </summary>
    [Fact]
    public void A_tone_inside_the_new_band_survives_resampling()
    {
        var wav = WriteWav(Tone(44100, 2.0, 1000, 0.5), 44100, channels: 1);

        var decoded = AudioDecoder.DecodeToMono(wav);
        var rms = Rms(decoded.Audio);

        // A 0.5-amplitude sine is 0.354 RMS.
        output.WriteLine($"1 kHz tone after 44.1k -> 22.05k: {rms:F6} RMS");
        Assert.InRange(rms, 0.33, 0.37);
    }

    [Fact]
    public void Stereo_folds_to_the_average_of_the_two_channels()
    {
        // Equal and opposite channels: a correct downmix cancels them.
        var left = Tone(44100, 1.0, 1000, 0.5);
        var right = Tone(44100, 1.0, 1000, 0.5);
        for (var i = 0; i < right.Length; i++)
        {
            right[i] = -right[i];
        }

        var wav = WriteInterleavedWav(left, right, 44100);

        var decoded = AudioDecoder.DecodeToMono(wav);

        Assert.Equal(2, decoded.SourceChannels);
        output.WriteLine($"cancelling stereo: {Rms(decoded.Audio):E3} RMS");
        Assert.True(Rms(decoded.Audio) < 1e-6);
    }

    [Fact]
    public void Mono_at_the_target_rate_passes_through_unresampled()
    {
        var samples = Tone(TargetRate, 1.0, 440, 0.5);
        var wav = WriteWav(samples, TargetRate, channels: 1);

        var decoded = AudioDecoder.DecodeToMono(wav);

        // No resampler in the chain, so this is sample-for-sample the input.
        Assert.Equal(samples.Length, decoded.Audio.Length);
        for (var i = 0; i < samples.Length; i++)
        {
            Assert.Equal(samples[i], decoded.Audio[i]);
        }
    }

    [Fact]
    public void Rejects_a_format_it_cannot_decode()
    {
        // An OGG page header: a real format, deliberately not supported.
        var ogg = new MemoryStream("OggS\0"u8.ToArray());

        var thrown = Assert.Throws<NotSupportedException>(() => AudioDecoder.DecodeToMono(ogg));
        Assert.Contains("FFmpeg", thrown.Message);
    }

    [Fact]
    public void Rejects_bytes_too_short_to_identify()
    {
        Assert.Throws<NotSupportedException>(
            () => AudioDecoder.DecodeToMono(new MemoryStream([0xFF])));
    }

    /// <summary>
    /// MP3 bytes reach the managed decoder rather than being rejected.
    /// </summary>
    /// <remarks>
    /// <b>This tests the dispatch, not the decoding.</b> There is no MP3 in this
    /// repository to decode — the one real recording the project uses is the
    /// user's file and is gitignored — and synthesising a valid MPEG stream to
    /// check a third-party decoder would be testing the synthesiser. So this
    /// pins the one thing that is genuinely this module's decision: that an ID3
    /// tag and a frame sync are both recognised and routed to
    /// <c>Mp3FrameDecompressor</c>, which is the managed decoder rather than the
    /// Windows-only ACM path NAudio reaches for by default. Whether NLayer
    /// decodes correctly is NLayer's business, and the first real stem through
    /// the pipeline is what will confirm it.
    /// </remarks>
    [Theory]
    [InlineData(new byte[] { (byte)'I', (byte)'D', (byte)'3', 3, 0, 0 })]
    [InlineData(new byte[] { 0xFF, 0xFB, 0x90, 0xC0, 0, 0 })]
    public void Mp3_headers_are_routed_to_the_managed_decoder(byte[] head)
    {
        var stream = new MemoryStream([.. head, .. new byte[512]]);

        // It will fail on the truncated body - what matters is how. A
        // NotSupportedException would mean the sniff did not recognise it.
        var thrown = Record.Exception(() => AudioDecoder.DecodeToMono(stream));

        output.WriteLine($"{BitConverter.ToString(head)} -> {thrown?.GetType().Name ?? "decoded"}");
        Assert.IsNotType<NotSupportedException>(thrown);
    }

    /// <summary>
    /// Decode and detection, joined up: a file in, the right pitch out.
    /// </summary>
    /// <remarks>
    /// The two halves are tested apart and this is the only place they meet.
    /// A2 at 110 Hz, written as 44.1 kHz stereo so the decode has both a
    /// downmix and a resample to do, and MIDI 45 is what has to come back.
    /// </remarks>
    [Fact]
    public void A_decoded_file_runs_through_the_detector()
    {
        var samples = Sawtooth(44100, 3.0, 110.0, 0.6);
        var wav = WriteInterleavedWav(samples, samples, 44100);

        var decoded = AudioDecoder.DecodeToMono(wav);

        using var detector = new BasicPitchDetector();
        var result = detector.Detect(decoded.Audio, TargetRate);

        var pitches = result.Notes.Select(n => n.Pitch).Distinct().OrderBy(p => p).ToArray();
        output.WriteLine($"{result.Notes.Count} notes, pitches {string.Join(" ", pitches)}");

        Assert.Contains(45, pitches);
    }

    // ----- helpers -----

    private static float[] Tone(int sampleRate, double seconds, double frequency, double amplitude)
    {
        var samples = new float[(int)(sampleRate * seconds)];
        for (var i = 0; i < samples.Length; i++)
        {
            samples[i] = (float)(amplitude * Math.Sin(2 * Math.PI * frequency * i / sampleRate));
        }

        return samples;
    }

    private static float[] Sawtooth(int sampleRate, double seconds, double frequency, double amplitude)
    {
        var samples = new float[(int)(sampleRate * seconds)];
        for (var i = 0; i < samples.Length; i++)
        {
            var phase = i * frequency / sampleRate;
            samples[i] = (float)(amplitude * (2 * (phase - Math.Floor(phase)) - 1));
        }

        return samples;
    }

    private static double Rms(float[] samples)
    {
        if (samples.Length == 0)
        {
            return 0;
        }

        var sum = 0.0;
        foreach (var sample in samples)
        {
            sum += (double)sample * sample;
        }

        return Math.Sqrt(sum / samples.Length);
    }

    private static MemoryStream WriteWav(float[] samples, int sampleRate, int channels)
    {
        var stream = new MemoryStream();
        var format = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, channels);

        // Left open so the stream survives the writer.
        using (var writer = new WaveFileWriter(new IgnoreDisposeStream(stream), format))
        {
            writer.WriteSamples(samples, 0, samples.Length);
        }

        stream.Position = 0;
        return stream;
    }

    private static MemoryStream WriteInterleavedWav(float[] left, float[] right, int sampleRate)
    {
        var interleaved = new float[left.Length * 2];
        for (var i = 0; i < left.Length; i++)
        {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
        }

        return WriteWav(interleaved, sampleRate, channels: 2);
    }
}
