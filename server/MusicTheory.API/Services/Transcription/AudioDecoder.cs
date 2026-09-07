using NAudio.Dsp;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using NLayer.NAudioSupport;

namespace MusicTheory.API.Services.Transcription;

/// <summary>
/// Turns an uploaded audio file into the mono 22.05 kHz signal
/// <see cref="BasicPitchDetector"/> expects.
/// </summary>
/// <remarks>
/// <para>
/// The server's answer to the client's <c>decodeToMono</c>, which goes through
/// Web Audio because <c>decodeAudioData</c> handles every container a browser
/// can play. Nothing here has that luxury, so the format list is explicit:
/// <b>WAV and MP3</b>. The design named this choice and left it open — NAudio
/// covers those two, and M4A, FLAC and OGG mean FFmpeg, with its licensing and
/// deployment weight. Two formats is where this starts.
/// </para>
///
/// <para><b>The resampler is the part that matters, and the naive one is a
/// trap.</b></para>
///
/// <para>
/// <c>audio-decode.ts</c> measured what happens when a rate conversion is done
/// by interpolation without a low-pass: a 15 kHz tone taken from 44.1 kHz to
/// 22.05 kHz survives at <b>0.41 RMS</b>, mirrored down to 7 kHz at near full
/// strength, against 0.00006 when the conversion is band-limited. Everything
/// above the new Nyquist folds back into the band, and a pitch detector fed
/// that invents notes out of the reflections. So this uses the Cockos WDL
/// resampler with its sinc filter on, which measures <b>0.00092</b> on the same
/// tone — see <see cref="BandLimitedResampler"/>, which also says why it does
/// not use NAudio's own wrapper around the same resampler. Both are fully
/// managed; NAudio's <c>MediaFoundationResampler</c> would also do the job and
/// is Windows-only, which is not a dependency worth taking for a server.
/// </para>
/// <para>
/// The same reasoning picks the MP3 decoder. NAudio's <c>Mp3FileReader</c>
/// decodes through Windows ACM; <see cref="Mp3FrameDecompressor"/> from NLayer
/// is managed and runs anywhere. Neither this class nor anything it calls is
/// Windows-only, which is the whole point of choosing them.
/// </para>
///
/// <para><b>Downmix before resample, and it commutes.</b> The client resamples
/// first and downmixes second, because Web Audio's decoder does the rate
/// conversion as part of decoding and the downmix has to happen afterwards.
/// Both operations are linear, so the order does not change the result beyond
/// floating point, and doing it this way round puts one channel through the
/// resampler instead of two.
/// </para>
///
/// <para><b>The two tiers will not decode a file to identical samples.</b>
/// Different decoders and different resamplers, so the audio the server sees
/// differs from the audio the browser sees in the last few bits — before the
/// model has run at all. That is a bigger source of divergence than the
/// 4.5e-7 the ONNX weights contribute, and it is why the acceptance criterion
/// is a derived <c>ScoreDoc</c> rather than a set of floats. Worth knowing
/// before anyone reads a note that moved by a frame as a bug.
/// </para>
/// </remarks>
public static class AudioDecoder
{
    /// <summary>Stereo downmix coefficients, matching Web Audio's speaker rules.</summary>
    /// <remarks>
    /// <c>0.5 * (L + R)</c>. Higher channel counts fold down with standard
    /// coefficients in the browser and are averaged here, which is not the same
    /// thing — see <see cref="DownmixToMono"/>.
    /// </remarks>
    private const float StereoCoefficient = 0.5f;

    /// <summary>
    /// Decodes <paramref name="data"/> to one channel at
    /// <paramref name="targetRate"/>.
    /// </summary>
    /// <param name="data">
    /// The file's bytes. Seekable; the format sniff reads the head and rewinds.
    /// </param>
    /// <param name="targetRate">
    /// Defaults to what the detector requires. Passing anything else is for
    /// tests.
    /// </param>
    /// <exception cref="NotSupportedException">
    /// The bytes are not a WAV or an MP3.
    /// </exception>
    public static DecodedAudio DecodeToMono(
        Stream data,
        int targetRate = DetectionFraming.DetectionSampleRate)
    {
        ArgumentNullException.ThrowIfNull(data);

        using var reader = OpenReader(data);
        var sourceSampleRate = reader.WaveFormat.SampleRate;
        var sourceChannels = reader.WaveFormat.Channels;

        ISampleProvider samples = reader.ToSampleProvider();
        samples = DownmixToMono(samples);

        if (samples.WaveFormat.SampleRate != targetRate)
        {
            samples = new BandLimitedResampler(samples, targetRate);
        }

        var audio = ReadToEnd(samples);

        return new DecodedAudio(
            audio,
            (double)audio.Length / targetRate,
            sourceSampleRate,
            sourceChannels);
    }

    /// <summary>
    /// Picks a reader from the bytes rather than from a file extension, which
    /// an upload does not have to tell the truth about.
    /// </summary>
    private static WaveStream OpenReader(Stream data)
    {
        if (data.CanSeek)
        {
            data.Position = 0;
        }

        Span<byte> head = stackalloc byte[3];
        var read = data.Read(head);
        if (data.CanSeek)
        {
            data.Position = 0;
        }

        if (read < 3)
        {
            throw new NotSupportedException(
                "Audio is too short to identify: expected a WAV or MP3 file.");
        }

        // "RIFF". The WAVE type is checked by the reader itself.
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F')
        {
            return new WaveFileReader(data);
        }

        // "ID3" tag, or an MPEG frame sync: eleven set bits.
        var isMpegSync = head[0] == 0xFF && (head[1] & 0xE0) == 0xE0;
        if ((head[0] == 'I' && head[1] == 'D' && head[2] == '3') || isMpegSync)
        {
            // The managed frame decompressor, not the Windows ACM one the
            // parameterless constructor reaches for.
            return new Mp3FileReaderBase(data, wave => new Mp3FrameDecompressor(wave));
        }

        throw new NotSupportedException(
            "Unsupported audio format: expected a WAV or MP3 file. M4A, FLAC and "
            + "OGG would need FFmpeg, which is a deliberate non-dependency.");
    }

    /// <summary>
    /// Folds every channel into one.
    /// </summary>
    /// <remarks>
    /// Stereo is <c>0.5 * (L + R)</c>, which is what Web Audio does. Beyond
    /// stereo this averages, where the browser applies the standard
    /// speaker-layout coefficients — a difference that only shows on surround
    /// material, which no instrument stem is, and which is called out rather
    /// than hidden because the alternative is a channel-layout table nothing
    /// currently exercises.
    /// </remarks>
    private static ISampleProvider DownmixToMono(ISampleProvider source)
    {
        return source.WaveFormat.Channels switch
        {
            1 => source,
            2 => new StereoToMonoSampleProvider(source)
            {
                LeftVolume = StereoCoefficient,
                RightVolume = StereoCoefficient
            },
            _ => new AverageChannelsSampleProvider(source)
        };
    }

    /// <summary>
    /// Drains a provider into one array.
    /// </summary>
    /// <remarks>
    /// Grown rather than sized in advance: a resampler cannot say how many
    /// samples it will produce, and an MP3's frame count is a header claim
    /// rather than a fact. A four-minute stem is 5.8 million floats, so the
    /// doubling costs a handful of copies.
    /// </remarks>
    private static float[] ReadToEnd(ISampleProvider source)
    {
        var buffer = new float[source.WaveFormat.SampleRate];
        var audio = new float[source.WaveFormat.SampleRate * 8];
        var total = 0;

        int read;
        while ((read = source.Read(buffer)) > 0)
        {
            if (total + read > audio.Length)
            {
                Array.Resize(ref audio, Math.Max(audio.Length * 2, total + read));
            }

            Array.Copy(buffer, 0, audio, total, read);
            total += read;
        }

        Array.Resize(ref audio, total);
        return audio;
    }

    /// <summary>
    /// The WDL resampler with its sinc filter switched on.
    /// </summary>
    /// <remarks>
    /// <para>
    /// NAudio's own <c>WdlResamplingSampleProvider</c> wraps the same resampler
    /// and configures it <c>SetMode(true, 2, false)</c> — two filter passes,
    /// <b>sinc off</b>. Measured on the 15 kHz tone that
    /// <c>audio-decode.ts</c> uses, that leaves <b>0.0085 RMS</b>: forty-eight
    /// times better than the interpolating resampler the client warns about, and
    /// a hundred and forty times worse than the browser's 0.00006.
    /// </para>
    /// <para>
    /// Turning sinc on costs this class and takes that to <b>0.00092</b> — 444
    /// times better than the interpolating resampler, and within fifteen of the
    /// browser. It is worth closing because the residue does not stay where it
    /// started: content between 11 and 22 kHz folds to <c>22050 - f</c>, so a
    /// 20 kHz component lands at 2 kHz, inside the model's pitch range, where it
    /// is a note-shaped thing rather than a hiss. The two decoders are the
    /// largest source of divergence between the tiers and this is the cheap
    /// part of it.
    /// </para>
    /// <para>
    /// <b>64 taps, and wider windows are not worth trying.</b> At 256 the same
    /// tone measures 0.000924 against 64's 0.000923 — the residual is the
    /// filter's design rather than its length, so the only thing a longer
    /// window buys is time. The passband is exact either way: a 0.5-amplitude
    /// sine comes back at 0.353553, which is 0.5 over root two to six places.
    /// </para>
    /// </remarks>
    private sealed class BandLimitedResampler : ISampleProvider
    {
        private readonly ISampleProvider _source;
        private readonly WdlResampler _resampler = new();

        public BandLimitedResampler(ISampleProvider source, int targetRate)
        {
            _source = source;

            // interp on, no cascaded filter passes, sinc on at 64 taps with a
            // 32-point interpolation table. WDL's own "good quality" setting;
            // larger windows buy attenuation this does not need.
            _resampler.SetMode(true, 0, true, 64, 32);
            _resampler.SetFilterParms();

            // Fed by output demand rather than input supply, which is what lets
            // Read ask for exactly as many samples as the caller wanted.
            _resampler.SetFeedMode(false);
            _resampler.SetRates(source.WaveFormat.SampleRate, targetRate);

            WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(
                targetRate,
                source.WaveFormat.Channels);
        }

        public WaveFormat WaveFormat { get; }

        public int Read(Span<float> buffer)
        {
            var channels = WaveFormat.Channels;
            var framesWanted = buffer.Length / channels;

            var framesNeeded = _resampler.ResamplePrepare(framesWanted, channels, out var input);
            var framesRead = _source.Read(input[..(framesNeeded * channels)]) / channels;

            return _resampler.ResampleOut(buffer, framesRead, framesWanted, channels) * channels;
        }
    }

    /// <summary>
    /// Averages every channel, for the layouts beyond stereo that NAudio has no
    /// downmix for.
    /// </summary>
    private sealed class AverageChannelsSampleProvider(ISampleProvider source) : ISampleProvider
    {
        private readonly int _channels = source.WaveFormat.Channels;
        private float[] _buffer = [];

        public WaveFormat WaveFormat { get; } =
            WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 1);

        public int Read(Span<float> buffer)
        {
            var wanted = buffer.Length * _channels;
            if (_buffer.Length < wanted)
            {
                _buffer = new float[wanted];
            }

            var read = source.Read(_buffer.AsSpan(0, wanted));
            var frames = read / _channels;

            for (var frame = 0; frame < frames; frame++)
            {
                var sum = 0f;
                for (var channel = 0; channel < _channels; channel++)
                {
                    sum += _buffer[frame * _channels + channel];
                }

                buffer[frame] = sum / _channels;
            }

            return frames;
        }
    }
}

/// <summary>Mono audio at the detector's rate, plus what the file said about itself.</summary>
/// <param name="Audio">Mono samples at the requested rate.</param>
/// <param name="DurationSec">Length of <paramref name="Audio"/> in seconds.</param>
/// <param name="SourceSampleRate">
/// The file's own rate, before resampling.
/// </param>
/// <param name="SourceChannels">The file's own channel count, before the downmix.</param>
/// <remarks>
/// The client reports <c>sourceSampleRate</c> as 0 for anything but WAV,
/// because nothing in Web Audio will tell it the file's own rate and it has to
/// read the RIFF header itself. NAudio knows it for both formats, so this is
/// always populated — a small thing the server can do that the browser cannot.
/// </remarks>
public readonly record struct DecodedAudio(
    float[] Audio,
    double DurationSec,
    int SourceSampleRate,
    int SourceChannels);
