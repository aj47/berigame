from pathlib import Path
import json,subprocess,re
import numpy as np
import soundfile as sf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parent
x,sr=sf.read(ROOT/'berigame-trailer-mix.wav')
m,_=sf.read(ROOT/'berigame-trailer-music.wav');s,_=sf.read(ROOT/'berigame-trailer-sfx.wav')
out=subprocess.run(['ffmpeg','-hide_banner','-i',str(ROOT/'berigame-trailer-mix.wav'),'-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
measure=json.loads(re.search(r'\{\s*"input_i".*?\}',out,re.S).group(0))
report=json.loads((ROOT/'qa.json').read_text())
report['verified_final']={'integrated_lufs':float(measure['input_i']),'true_peak_dbtp':float(measure['input_tp']),'loudness_range_lu':float(measure['input_lra']),'clipped_samples':int(np.sum(np.abs(x)>=1)),'stem_sum_max_error':float(np.max(np.abs(x-m-s))),'final_sample_max_abs':float(np.max(np.abs(x[-1]))),'all_finite':bool(np.isfinite(x).all()),'stereo_correlation':float(np.corrcoef(x.T)[0,1])}
(ROOT/'qa.json').write_text(json.dumps(report,indent=2))
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'text.color':'#eee4cf','axes.labelcolor':'#eee4cf','xtick.color':'#eee4cf','ytick.color':'#eee4cf','axes.edgecolor':'#5f6b5c'})
fig,axes=plt.subplots(3,1,figsize=(15,8),gridspec_kw={'height_ratios':[2,1,1]},sharex=True)
fig.patch.set_facecolor('#1a291f')
block=480
for ax,y,color,label in [(axes[0],x,'#b9d980','Full mix'),(axes[1],m,'#ecc17d','Music stem'),(axes[2],s,'#94cad0','Sound design stem')]:
 ax.set_facecolor('#213527');z=y.mean(axis=1).reshape(-1,block);t=(np.arange(len(z))+.5)*block/sr
 ax.fill_between(t,z.min(axis=1),z.max(axis=1),color=color,linewidth=0)
 ax.set_ylabel(label);ax.grid(alpha=.12);ax.set_xlim(0,40)
 for time in [4,8,13,17,22,27,33]:ax.axvline(time,color='#f8efde',alpha=.22,linewidth=.8)
axes[0].set_title('BeriGame — Small Friends, Great Big World\n40 seconds · 48 kHz stereo · −16.04 LUFS · −1.24 dBTP · 0 clipped samples',color='#fff4d8',fontsize=15,pad=18)
axes[2].set_xlabel('Seconds')
for a,b,label in [(0,4,'Wonder'),(4,8,'Vista'),(8,13,'Journey'),(13,17,'Pip'),(17,22,'Giant'),(22,27,'Together'),(27,33,'Feast'),(33,40,'BeriGame')]:axes[0].text((a+b)/2,.92,label,ha='center',va='top',transform=axes[0].get_xaxis_transform(),fontsize=9,color='#ffe7a9')
fig.tight_layout();fig.savefig(ROOT/'audio-waveform-qa.png',dpi=150,facecolor=fig.get_facecolor())
print(json.dumps(report['verified_final'],indent=2))
