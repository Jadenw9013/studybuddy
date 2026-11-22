# Offline synthetic speech for the explicitly paid DSA voice browser probe.
# Run with Windows PowerShell (powershell.exe), not a cloud speech service.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$dsaProjectRoot = Split-Path -Parent $PSScriptRoot
$dsaAudioRoot = Join-Path $dsaProjectRoot '.data\dsa-switching-audio'
New-Item -ItemType Directory -Path $dsaAudioRoot -Force | Out-Null
$dsaSpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $dsaEnglishVoices = @($dsaSpeech.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' })
    if ($dsaEnglishVoices.Count -eq 0) { throw 'An installed English Windows speech voice is required for this synthetic-audio probe.' }
    $dsaVoice = $dsaEnglishVoices | Where-Object { $_.VoiceInfo.Name -eq 'Microsoft Zira Desktop' } | Select-Object -First 1
    if (-not $dsaVoice) { $dsaVoice = $dsaEnglishVoices[0] }
    $dsaSpeech.SelectVoice($dsaVoice.VoiceInfo.Name)
    $dsaSpeech.Rate = 1
    $dsaFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $dsaQuestions = @{
        'tree.wav' = 'Now show the binary tree using in order traversal. Start at step zero and explain only the displayed step.'
        'bst.wav' = 'Now show the binary search tree. Search for the target seven, starting at step zero. Explain only the displayed step.'
    }
    foreach ($dsaName in $dsaQuestions.Keys) {
        $dsaSpeech.SetOutputToWaveFile((Join-Path $dsaAudioRoot $dsaName),$dsaFormat)
        $dsaSpeech.Speak($dsaQuestions[$dsaName])
        $dsaSpeech.SetOutputToNull()
    }
    Get-ChildItem -LiteralPath $dsaAudioRoot | Select-Object Name,Length
} finally {
    $dsaSpeech.Dispose()
}
