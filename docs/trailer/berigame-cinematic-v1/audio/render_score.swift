import Foundation
import AVFoundation
struct Event: Decodable { let time:Double;let type:String;let pitch:Int?;let duration:Double?;let velocity:Int?;let controller:Int?;let value:Int? }
struct Track:Decodable { let name:String;let program:Int;let bank:Int;let events:[Event] }
struct Score:Decodable { let duration:Double;let sample_rate:Double;let tracks:[Track] }
struct MidiEvent { let frame:Int64;let kind:Int;let a:UInt8;let b:UInt8 }
func render(_ track:Track,_ score:Score,_ folder:URL) throws {
    let engine=AVAudioEngine();let sampler=AVAudioUnitSampler();engine.attach(sampler)
    let format=AVAudioFormat(standardFormatWithSampleRate:score.sample_rate,channels:2)!
    engine.connect(sampler,to:engine.mainMixerNode,format:format)
    let sf=URL(fileURLWithPath:"/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
    try sampler.loadSoundBankInstrument(at:sf,program:UInt8(track.program),bankMSB:UInt8(track.bank),bankLSB:0)
    sampler.sendController(91,withValue:0,onChannel:0)
    sampler.sendController(93,withValue:0,onChannel:0)
    var events:[MidiEvent]=[]
    for e in track.events {
        let f=Int64(e.time*score.sample_rate)
        if e.type=="note" {
            events.append(MidiEvent(frame:f,kind:0,a:UInt8(e.pitch!),b:UInt8(e.velocity!)))
            events.append(MidiEvent(frame:Int64((e.time+e.duration!)*score.sample_rate),kind:1,a:UInt8(e.pitch!),b:0))
        } else { events.append(MidiEvent(frame:f,kind:2,a:UInt8(e.controller!),b:UInt8(e.value!))) }
    }
    events.sort { $0.frame == $1.frame ? $0.kind > $1.kind : $0.frame < $1.frame }
    try engine.enableManualRenderingMode(.offline,format:format,maximumFrameCount:512)
    try engine.start()
    let settings:[String:Any]=[AVFormatIDKey:kAudioFormatLinearPCM,AVSampleRateKey:score.sample_rate,AVNumberOfChannelsKey:2,AVLinearPCMBitDepthKey:24,AVLinearPCMIsFloatKey:false,AVLinearPCMIsBigEndianKey:false]
    var file:AVAudioFile?=try AVAudioFile(forWriting:folder.appendingPathComponent(track.name+".wav"),settings:settings)
    let buf=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:512)!
    let frames=Int64(score.duration*score.sample_rate)
    var cursor:Int64=0;var ix=0
    while cursor<frames {
        while ix<events.count && events[ix].frame<=cursor {
            let e=events[ix]
            if e.kind==0 {sampler.startNote(e.a,withVelocity:e.b,onChannel:0)}
            else if e.kind==1 {sampler.stopNote(e.a,onChannel:0)}
            else {sampler.sendController(e.a,withValue:e.b,onChannel:0)}
            ix+=1
        }
        var count=min(Int64(512),frames-cursor)
        if ix<events.count {count=min(count,max(1,events[ix].frame-cursor))}
        let status=try engine.renderOffline(AVAudioFrameCount(count),to:buf)
        if status == .success {try file!.write(from:buf);cursor+=count}
        else if status == .cannotDoInCurrentContext {continue}
        else {throw NSError(domain:"Render",code:1,userInfo:[NSLocalizedDescriptionKey:"Failed render \(status)"])}
    }
    engine.stop();file=nil
    print("Rendered \(track.name) (\(frames) samples)")
}
let path=URL(fileURLWithPath:CommandLine.arguments[1])
let score=try JSONDecoder().decode(Score.self,from:Data(contentsOf:path))
let folder=path.deletingLastPathComponent().appendingPathComponent("instrument-stems")
try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
for track in score.tracks {try autoreleasepool {try render(track,score,folder)}}
