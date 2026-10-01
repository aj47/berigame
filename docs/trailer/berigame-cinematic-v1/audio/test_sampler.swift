import Foundation
import AVFoundation
let engine = AVAudioEngine()
let sampler = AVAudioUnitSampler()
engine.attach(sampler)
let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
engine.connect(sampler, to: engine.mainMixerNode, format: format)
try sampler.loadSoundBankInstrument(at: URL(fileURLWithPath:"/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"), program: 46, bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB), bankLSB: 0)
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 512)
try engine.start()
let out = URL(fileURLWithPath:CommandLine.arguments[1])
let file = try AVAudioFile(forWriting: out, settings: format.settings)
let buf = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity:512)!
sampler.startNote(62, withVelocity:100, onChannel:0)
for i in 0..<188 {
 if i==95 {sampler.stopNote(62,onChannel:0)}
 let status = try engine.renderOffline(512,to:buf)
 if status == .success {try file.write(from:buf)}
}
engine.stop()
print("Done",file.length)
