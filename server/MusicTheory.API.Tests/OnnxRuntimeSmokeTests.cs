using Microsoft.ML.OnnxRuntime;

namespace MusicTheory.API.Tests;

/// <summary>
/// Proves that <c>Microsoft.ML.OnnxRuntime</c> is not just referenced but
/// actually loadable here.
/// </summary>
/// <remarks>
/// <para>
/// The managed package restores on any machine; the native library beside it
/// does not, and when it fails it fails at the first call rather than at build.
/// That is a bad thing to discover from a deploy. This costs a millisecond and
/// turns it into a red test.
/// </para>
/// <para>
/// It deliberately does not load a model. Basic Pitch ships as TF.js — a
/// <c>model.json</c> and a weight shard — and converting it to ONNX is its own
/// step with its own verification; until that lands there is nothing to load,
/// and pretending otherwise with a toy graph would test the toy.
/// </para>
/// </remarks>
public class OnnxRuntimeSmokeTests
{
    [Fact]
    public void Native_runtime_loads_and_reports_its_execution_providers()
    {
        using var options = new SessionOptions();

        var providers = OrtEnv.Instance().GetAvailableProviders();

        Assert.NotEmpty(providers);
        Assert.Contains("CPUExecutionProvider", providers);
    }
}
