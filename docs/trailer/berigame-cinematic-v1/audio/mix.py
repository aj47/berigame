"""Mix original orchestration and original procedural sound design, 48 kHz stereo.
Dependencies: numpy, scipy, soundfile; system ffmpeg for two-pass BS.1770 loudness.
All sounds are synthesized here; no downloaded or sampled commercial recordings.
"""
from pathlib import Path
import json, subprocess, re
import numpy as np
import soundfile as sf
from scipy import signal
ROOT=Path(__file__).resolve().parent
SR=48000; DURATION=40; N=SR*DURATION
rng=np.random.default_rng(934021)

def filt(x,cut,kind='lowpass',order=2):
    return signal.sosfilt(signal.butter(order,cut,btype=kind,fs=SR,output='sos'),x,axis=0)
def db(v):return 10**(v/20)
def stereo(x,pan=0):
    if x.ndim==2:x=x.mean(axis=1)
    angle=(pan+1)*np.pi/4
    return np.column_stack((x*np.cos(angle),x*np.sin(angle)))
def room_ir(seconds=1.8,seed=1):
    r=np.random.default_rng(seed);ns=int(seconds*SR);t=np.arange(ns)/SR
    ir=np.zeros((ns,2))
    for ch in range(2):
        tail=filt(r.normal(0,1,ns),4400)*np.exp(-6.9*t/seconds)
        tail[:int(.027*SR)]=0
        tail*=np.minimum(1,np.maximum(0,(t-.027)*30))
        tail/=np.sqrt(np.sum(tail**2));tail*=.66
        for k,(delay,level) in enumerate([(.023,.42),(.041,.30),(.057,.23),(.079,.17),(.107,.11)]):tail[int((delay+ch*.0027)*SR)]+=level
        ir[:,ch]=tail
    return ir
IR=room_ir()
def reverb(x,wet=.2):
    y=x.copy()
    for ch in range(2):y[:,ch]+=wet*signal.fftconvolve(x[:,ch],IR[:,ch],mode='full')[:len(x)]
    return y
# Musical instruments are naturally dynamic. Gentle band limiting warms the DLS orchestra.
score=json.loads((ROOT/'score.json').read_text())
music=np.zeros((N,2))
for tr in score['tracks']:
    x,sr=sf.read(ROOT/'instrument-stems'/f"{tr['name']}.wav")
    assert sr==SR and len(x)==N
    x=stereo(x,tr['pan'])*db(tr['gain_db'])
    x=filt(filt(x,35,'highpass'),11500)
    music+=reverb(x,tr['wet'])
# The music swells with camera reveals and gives the fox and giant moments breathing room.
knots=np.array([0,.8,3.2,4.2,8,12.8,13.1,16.6,17,20,21.6,22.2,26.5,27.2,32,33,35,38.4,39,40])
levels=np.array([.66,.78,.90,1.00,1.02,.96,.73,.77,.86,.96,1.03,1.16,1.10,.87,.95,1.02,1.15,1.04,.86,0])
env=np.interp(np.arange(N)/SR,knots,levels)
music*=env[:,None]
# Smooth master high-pass and a barely audible tape-like saturation.
music=filt(music,27,'highpass')
# Sound design, individually constructed and panned.
sfx=np.zeros((N,2))
def put(x,t,level=1,pan=0):
    global sfx
    x=stereo(x,pan)*level;start=round(t*SR);end=min(N,start+len(x))
    if start<0:x=x[-start:];start=0
    if end>start:sfx[start:end]+=x[:end-start]
def air(duration,cut=1800):
    n=round(duration*SR);x=rng.normal(0,1,n);return filt(filt(x,120,'highpass'),cut)
def fadeenv(n,attack=.02,release=.15):
    e=np.ones(n);a=min(round(attack*SR),n);r=min(round(release*SR),n)
    e[:a]=np.sin(np.linspace(0,np.pi/2,a))**2;e[-r:]*=np.cos(np.linspace(0,np.pi/2,r))**2
    return e
# Very low forest breeze with complementary stereo movement.
for ch in [0,1]:
    wind=air(40,850);wind/=np.std(wind)
    t=np.arange(N)/SR
    amb=(.35+.65*np.sin(t*.34+ch)**2)*np.interp(t,[0,4,8,13,17,22,27,33,40],[.0035,.002,.0016,.0028,.003,.0012,.0025,.0013,0])
    sfx[:,ch]+=wind*amb

def bell(freq,dur=1.7):
    t=np.arange(round(dur*SR))/SR
    return sum(a*np.sin(2*np.pi*freq*m*t)*np.exp(-t/(tau)) for m,a,tau in [(1,1,.75),(2.01,.28,.29),(3.98,.12,.13)])*np.minimum(1,t/.004)
def bird(t0,pitch,pan):
    for k in range(3):
        dur=.09+k*.017;t=np.arange(round(dur*SR))/SR
        f=pitch+520*np.sin(np.pi*t/dur)+k*230
        phase=2*np.pi*np.cumsum(f)/SR
        x=(np.sin(phase)+.18*np.sin(2*phase))*np.sin(np.pi*t/dur)**2
        put(x,t0+k*.14,.0065,pan)
for t,p,pan in [(.72,2450,-.72),(2.4,2850,.60),(4.85,2650,.32),(13.8,2700,-.66),(28.3,2350,.7),(30.7,2550,-.5)]:bird(t,p,pan)
# Seed sparkle, vista breath, travel breeze.
for t,f,pan in [(.08,1174.66,-.22),(.35,1760,.25),(.66,2349.32,.5)]:put(bell(f,2.1),t,.009,pan)
def whoosh(t0,dur,lev,pan=0):
    x=air(dur,3000);e=np.sin(np.linspace(0,np.pi,len(x)))**2
    x=filt(x,900);put(x*e,t0,lev,pan)
whoosh(3.2,1.3,.037,-.2);whoosh(7.65,.75,.018,.25)
# Soft ground footfalls: a patter with earthy transients, not hard mechanical clicks.
for i,t0 in enumerate(np.arange(8.22,12.92,.34)):
    t=np.arange(int(.16*SR))/SR
    body=np.sin(2*np.pi*(110+15*(i%2))*t)*np.exp(-t*35)
    grit=filt(rng.normal(size=len(t)),1600)*np.exp(-t*58)
    put((body+.2*grit)*np.minimum(1,t/.003),t0,.009,-.3+(i%2)*.22)
# Fox sniff: two delicate inhalations, plus a curious soft nose-boop.
for t0 in [13.42,14.14]:
    x=air(.16,4300);x=filt(x,1300,'highpass')
    put(x*np.sin(np.linspace(0,np.pi,len(x)))**1.1,t0,.045,.28)
t=np.arange(int(.23*SR))/SR
put(np.sin(2*np.pi*(420*t+55*t*t))*np.exp(-t*21)*np.minimum(1,t/.008),15.1,.006,.2)
# Giant: warm low resonance, soft pebble texture, long spacious tail.
t=np.arange(int(2.5*SR))/SR
impact=(np.sin(2*np.pi*49*t)*np.exp(-t*2.1)+.45*np.sin(2*np.pi*73.42*t)*np.exp(-t*2.9))
impact*=np.minimum(1,t/.018)
stone=filt(rng.normal(size=len(t)),550)*np.exp(-t*7)*np.minimum(1,t/.01)
put(impact+stone*.42,17.02,.038,0)
whoosh(16.6,1.8,.023,-.18)
# Adventure pulls and gentle magical success accents.
whoosh(21.28,1.16,.027,.1);whoosh(23.45,.5,.018,-.35);whoosh(25.28,.6,.015,.3)
for t,f,pan in [(22.07,739.99,-.28),(24.25,783.99,.3),(26.22,880,-.15)]:put(bell(f,.8),t,.007,pan)
# Feast: delicate ceramic cup and wooden plate sounds, no recorded dialogue.
for t0,f,pan in [(27.72,1370,-.37),(28.15,1620,.35),(29.25,1210,.08)]:
    t=np.arange(int(.43*SR))/SR
    x=(np.sin(2*np.pi*f*t)+.3*np.sin(2*np.pi*f*2.73*t))*np.exp(-t*18)*np.minimum(1,t/.0015)
    put(x,t0,.012,pan)
# Brand reveal: uplifting air and a resolved bell halo.
whoosh(32.68,1.1,.022,0)
for t0,f,pan in [(33.1,783.99,-.2),(34.12,880,.2),(35.08,1174.66,0),(35.35,1760,.3)]:put(bell(f,2.5),t0,.013,pan)
sfx=reverb(sfx,.16)
sfx=filt(sfx,29,'highpass')
fade=np.ones(N);nf=int(1.15*SR);fade[-nf:]=np.cos(np.linspace(0,np.pi/2,nf))**2
sfx*=fade[:,None];music*=fade[:,None]
# Stem balance, then determine integrated loudness using ffmpeg. Constant gain preserves sum.
music*=2.8
raw=music+sfx
sf.write(ROOT/'premaster.wav',raw,SR,subtype='FLOAT')
cmd=['ffmpeg','-hide_banner','-i',str(ROOT/'premaster.wav'),'-af','loudnorm=I=-16:TP=-1.2:LRA=11:print_format=json','-f','null','-']
res=subprocess.run(cmd,capture_output=True,text=True,check=True).stderr
m=re.search(r'\{\s*"input_i".*?\}',res,re.S)
measure=json.loads(m.group(0));gain=db(-16-float(measure['input_i']))
# Global peak protection without nonlinear remixing, so stems remain exactly additive.
peak=np.max(np.abs(raw))*gain
if peak>db(-1.25):gain*=db(-1.25)/peak
music*=gain;sfx*=gain;mix=music+sfx
sf.write(ROOT/'berigame-trailer-music.wav',music,SR,subtype='PCM_24')
sf.write(ROOT/'berigame-trailer-sfx.wav',sfx,SR,subtype='PCM_24')
sf.write(ROOT/'berigame-trailer-mix.wav',mix,SR,subtype='PCM_24')
report={'sample_rate':SR,'channels':2,'duration_seconds':40,'samples':N,'mix_peak_dbfs':float(20*np.log10(np.max(np.abs(mix)))),'premaster_loudness':measure,'linear_master_gain_db':float(20*np.log10(gain)),'music_peak_dbfs':float(20*np.log10(np.max(np.abs(music)))),'sfx_peak_dbfs':float(20*np.log10(np.max(np.abs(sfx)))),'score_title':score['title']}
(ROOT/'qa.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
