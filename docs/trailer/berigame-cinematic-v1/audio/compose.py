"""Original BeriGame score: 'Small Friends, Great Big World' (40 seconds).
No external musical source or recording. GM orchestration uses Apple's system DLS.
Run: python3 compose.py && swift render_score.swift score.json && python3 mix.py
"""
from pathlib import Path
import json, random
ROOT=Path(__file__).resolve().parent
rng=random.Random(20260930)
tracks={}
def tr(name,program,gain,pan,wet=0.18,bank=121):
    tracks[name]={'name':name,'program':program,'bank':bank,'gain_db':gain,'pan':pan,'wet':wet,'events':[]}
tr('harp',46,-6,-0.3,0.23)
tr('celesta',8,-1,0.26,0.24)
tr('glockenspiel',9,-15,0.12,0.32)
tr('violins',48,-6,-0.32,0.24)
tr('violas',48,-3,0.25,0.23)
tr('cello',42,-5,0.22,0.18)
tr('horns',60,-3,-0.1,0.26)
tr('flute',73,-11,-0.16,0.18)
tr('bassoon',70,-7,0.12,0.15)
tr('pizzicato',45,-3,-0.1,0.12)
tr('acoustic_bass',32,-7,0.05,0.1)
tr('timpani',47,-7,-0.08,0.22)
tr('orchestral_drums',0,-7,0.05,0.20,120)

def note(track,t,p,d=.4,v=70, jitter=0):
    t=max(0,t+rng.uniform(-jitter,jitter))
    if t>=39.85: return
    tracks[track]['events'].append({'time':round(t,5),'type':'note','pitch':p,'duration':round(min(d,40-t),5),'velocity':max(1,min(127,round(v+rng.uniform(-3,3))))})
def cc(track,t,n,v):
    tracks[track]['events'].append({'time':round(t,5),'type':'cc','controller':n,'value':round(v)})
def chord(track,t,ps,d,v):
    for i,p in enumerate(ps): note(track,t+i*.007,p,d,v)
def swell(track,t,d,a,b):
    for k in range(16): cc(track,t+d*k/15,11,a+(b-a)*k/15)
def melody(track,t,seq,v=80,step=.5):
    for p,n in seq:
        if p is not None: note(track,t,p,step*n*.9,v,jitter=.008)
        t+=step*n
# Musical harmony is D major with a brief G Lydian sparkle, original pentatonic motif.
# 0-4 — a seed of wonder, suspended Dadd9.
chord('violas',.0,[57,62,64],3.9,40); swell('violas',0,3.8,35,62)
note('cello',.2,38,3.5,37)
for t,p,v in [(0.12,74,55),(.7,81,52),(1.36,78,56),(2.12,76,50),(2.72,86,47),(3.24,81,55)]: note('celesta',t,p,1.4,v)
for t,p in [(0.0,50),(.5,57),(1.0,62),(1.5,66),(2,69),(2.5,74),(3,76),(3.5,81)]: note('harp',t,p,1.65,48)
# 4-8 — first vista, warm brass and blooming string harmony.
for t,low,mid,high in [(4,38,[57,62,66],[69,74,78]),(6,43,[55,59,62],[67,74,78])]:
    chord('violins',t,high,1.93,66); chord('violas',t,mid,1.95,62)
    note('cello',t,low,1.96,60); chord('horns',t,[mid[0],mid[2]],1.85,55)
    note('timpani',t,low,1.1,48)
melody('flute',4,[(78,1),(81,1),(83,2),(81,1),(78,1),(76,2)],75)
for i,p in enumerate([62,66,69,74,62,67,71,74]): note('harp',4+i*.5,p,.9,62)
swell('violins',4,3.8,67,100); swell('horns',4,3.8,75,96)
# 8-13 — a tiny expedition, nimble feet and wind instruments.
carry=[(8,38,[62,66,69]),(10,47,[59,62,66]),(12,43,[59,62,67])]
for t,b,ps in carry:
    dur=min(2,13-t)
    note('acoustic_bass',t,b,.45,74); note('cello',t,b,dur*.95,52)
    chord('violas',t,ps,dur*.93,49)
    for j in range(round(dur/.25)):
        note('pizzicato',t+j*.25,ps[j%len(ps)],.18,59+(j%2)*8,jitter=.012)
    for j in range(round(dur/.5)):
        note('orchestral_drums',t+j*.5,54,.15,38+(j%2)*12,jitter=.008)
        if j%2==0: note('orchestral_drums',t+j*.5,36,.2,51)
melody('flute',8,[(74,1),(78,.5),(81,.5),(83,1),(81,.5),(78,.5),(76,1),(78,.5),(74,.5),(71,1),(74,1),(78,1),(76,1)],85)
melody('celesta',8,[(86,2),(90,2),(88,2),(83,2),(86,2)],44)
# 13-17 — Pip's nose knows: comic pizz and bassoon, room to breathe.
for t,p in [(13,50),(13.45,57),(14,54),(14.4,61),(15,55),(15.45,62),(16.05,57),(16.55,64)]:
    note('pizzicato',t,p,.22,68)
melody('bassoon',13.05,[(62,.6),(66,.4),(69,1),(66,.5),(64,.5),(62,1),(59,1),(62,.5),(66,.5),(64,1),(61,1)],75)
for t,p in [(13.72,86),(14.74,83),(15.72,90),(16.42,88)]: note('celesta',t,p,.65,51)
chord('violas',13,[54,57,62],1.7,33);chord('violas',15,[55,59,62],1.7,34)
# 17-22 — the gentle Giant; broad mystery, never threatening.
chord('cello',17,[38,45],2.8,58); chord('violas',17,[57,62,66],2.8,57)
chord('violins',17.2,[69,74,78],2.7,48); swell('violins',17.1,2.8,35,100)
note('timpani',17,38,2,68)
melody('horns',17.4,[(62,2),(66,2),(69,2),(71,2),(73,1)],65)
for t,p in [(17.4,62),(18.1,69),(18.6,74),(19.1,78),(19.6,81)]:note('harp',t,p,1.5,57)
chord('cello',20,[45,52],1.9,61);chord('violas',20,[57,61,64],1.9,63);chord('violins',20,[69,73,76],1.9,70)
for i in range(8): note('timpani',20+i*.25,45,.32,42+i*4)
for i in range(8):note('harp',20+i*.25,[57,61,64,69,73,76,81,85][i],.8,58+i*2)
# 22-27 — friends pull together. Full statement of the adventure theme.
for t,b,ps,hs in [(22,38,[57,62,66],[69,74,78]),(24,43,[55,59,62],[67,74,79]),(26,45,[57,61,64],[69,73,76])]:
    dur=min(2,27-t)
    chord('violins',t,hs,dur*.98,79);chord('violas',t,ps,dur*.98,72);note('cello',t,b,dur*.94,77)
    note('acoustic_bass',t,b,.55,82);note('timpani',t,b,.75,75)
    for j in range(round(dur/.25)):
        note('pizzicato',t+j*.25,ps[j%3],.18,77,jitter=.008)
        note('orchestral_drums',t+j*.25,54,.12,38+(j%2)*15,jitter=.008)
    for j in range(round(dur/.5)):
        note('orchestral_drums',t+j*.5,36 if j%2==0 else 38,.16,62 if j%2==0 else 44)
    for j in range(round(dur/.5)):note('harp',t+j*.5,hs[j%3],.7,66)
melody('horns',22,[(62,1),(66,1),(69,1),(71,1),(74,2),(71,1),(69,1),(66,1),(64,1)],83)
melody('flute',22,[(74,1),(78,1),(81,1),(83,1),(86,2),(83,1),(81,1),(78,1),(76,1)],67)
note('orchestral_drums',22,49,1.8,62)
for t,p in [(22,86),(24,91),(26,88)]:note('glockenspiel',t,p,1.2,56)
# 27-33 — gathering, sharing; soften into a lush, welcoming response.
for t,b,ps,hs in [(27,47,[59,62,66],[71,74,78]),(29,43,[55,59,62],[67,71,74]),(31,38,[57,62,66],[69,74,78])]:
    note('cello',t,b,1.95,57); chord('violas',t,ps,1.96,57);chord('violins',t,hs,1.96,55)
    for i,p in enumerate(ps+hs):note('harp',t+i*.3,p,1.3,57)
melody('flute',27,[(83,2),(81,1),(78,1),(79,2),(78,1),(76,1),(74,3),(78,1)],70)
melody('celesta',27.1,[(71,2),(74,2),(71,2),(67,2),(69,2),(74,2)],50)
swell('horns',27,1,95,72)
# 33-40 — logo statement, a clear IV-V-I resolution and held D6/9 halo.
for t,b,ps,hs,d in [(33,43,[55,59,62],[67,74,79],1),(34,45,[57,61,64],[69,73,76],1),(35,38,[57,62,66],[69,74,78],4.3)]:
    note('cello',t,b,d,68);chord('violas',t,ps,d,68);chord('violins',t,hs,d,70)
    chord('horns',t,[ps[0],ps[2]],d*.94,67)
    note('timpani',t,b,min(1.5,d),62)
melody('flute',33,[(79,1),(78,1),(76,1),(73,1),(74,7)],73)
melody('celesta',33,[(91,1),(90,1),(88,1),(85,1),(86,7)],55)
note('orchestral_drums',35,49,2.5,45)
for i,p in enumerate([50,57,62,66,69,74,78,81,86]):note('harp',35+i*.12,p,3.5,65-i*2)
note('glockenspiel',35.9,86,3.1,54)
for trk in ['violins','violas','cello','horns']:swell(trk,36.5,2.5,95,50)
# Dynamics and MIDI cleanup.
for t in tracks.values():
    t['events']=sorted(t['events'],key=lambda x:x['time'])
(ROOT/'score.json').write_text(json.dumps({'title':'Small Friends, Great Big World','duration':40,'sample_rate':48000,'tempo':120,'key':'D major','tracks':list(tracks.values())},indent=2))
print('Wrote',len(tracks),'orchestral parts and',sum(len(t['events']) for t in tracks.values()),'score events')
