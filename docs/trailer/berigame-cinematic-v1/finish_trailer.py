#!/usr/bin/env python3
"""Finish the 40-second BeriGame trailer from the approved rendered frame sequence.

Check without encoding or writing files:
    python3 finish_trailer.py --check-only

Encode the trailer and inspect frames extracted from the resulting MP4:
    python3 finish_trailer.py

Optional separate clean master:
    python3 finish_trailer.py --also-textless

Requires ffmpeg, ffprobe, and Pillow. No shell commands are evaluated. All filter
and codec threads are bounded to two to keep the six image streams manageable.
"""
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT, FPS, FRAME_COUNT = 1920, 1080, 24, 960
DURATION = FRAME_COUNT / FPS
SAMPLE_TIMES = (2.0, 6.0, 10.0, 15.0, 19.5, 24.5, 30.0, 36.0, 39.9)
OUTPUT_NAME = 'berigame-cinematic-trailer-1080p.mp4'


def run_json(args: list[str]) -> dict[str, Any]:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def probe(path: Path, ffprobe: str) -> dict[str, Any]:
    return run_json([ffprobe, '-v', 'error', '-show_format', '-show_streams',
                     '-of', 'json', str(path)])


def inspect_inputs(root: Path, ffprobe: str | None) -> tuple[dict[str, Any], list[str]]:
    """Inspect image headers and audio metadata; never create or alter any file."""
    errors: list[str] = []
    frame_dir = root / 'frames'
    expected_frames = [frame_dir / f'frame-{i:04d}.png' for i in range(1, FRAME_COUNT + 1)]
    missing = [p.name for p in expected_frames if not p.is_file()]
    invalid = []
    present = 0
    for path in expected_frames:
        if not path.is_file():
            continue
        present += 1
        try:
            with Image.open(path) as im:
                if im.format != 'PNG' or im.size != (WIDTH, HEIGHT):
                    invalid.append(f'{path.name}: {im.format} {im.size}')
                elif im.mode not in ('RGB', 'RGBA'):
                    invalid.append(f'{path.name}: unsupported {im.mode} mode')
        except (OSError, ValueError) as exc:
            invalid.append(f'{path.name}: {exc}')
    if missing:
        errors.append(f'Missing {len(missing)} of {FRAME_COUNT} frames; first missing: {", ".join(missing[:5])}')
    if invalid:
        errors.append(f'Invalid frame headers ({len(invalid)}): {"; ".join(invalid[:5])}')

    manifest_path = root / 'titles' / 'manifest.json'
    manifest: dict[str, Any] = {}
    overlays: list[dict[str, Any]] = []
    try:
        manifest = json.loads(manifest_path.read_text())
        overlays = manifest['overlays']
        if manifest.get('frame_size') != [WIDTH, HEIGHT]:
            errors.append('Title manifest frame_size must be [1920, 1080].')
        if len(overlays) != 5:
            errors.append(f'Expected five overlay PNGs; found {len(overlays)}.')
        previous_end = 0.0
        for i, item in enumerate(overlays):
            name = item['file']
            if Path(name).name != name or Path(name).suffix.lower() != '.png':
                errors.append(f'Overlay file must be a PNG filename inside titles/: {name!r}')
                continue
            start, end = float(item['start']), float(item['end'])
            fade_in, fade_out = float(item['fade_in']), float(item['fade_out'])
            values = (start, end, fade_in, fade_out)
            if not all(math.isfinite(v) for v in values):
                errors.append(f'{name}: non-finite timing.')
            elif not 0 <= start < end <= DURATION:
                errors.append(f'{name}: timing outside 0–{DURATION:g} seconds.')
            elif fade_in <= 0 or fade_out < 0 or fade_in + fade_out > end - start:
                errors.append(f'{name}: invalid fade lengths.')
            elif start < previous_end:
                errors.append(f'{name}: unexpectedly overlaps preceding title.')
            previous_end = end
            with Image.open(root / 'titles' / name) as im:
                if im.size != (WIDTH, HEIGHT) or im.mode != 'RGBA':
                    errors.append(f'{name}: must be 1920×1080 RGBA, got {im.size} {im.mode}.')
                else:
                    if im.getchannel('A').getextrema() != (0, 255):
                        errors.append(f'{name}: alpha must contain both transparent and opaque pixels.')
            if i == len(overlays) - 1 and abs(end - DURATION) > 0.001:
                errors.append('Final title must continue through the 40-second endpoint.')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(f'Cannot validate title manifest/assets: {exc}')

    audio_path = root / 'audio' / 'berigame-trailer-mix.wav'
    audio_info: dict[str, Any] = {}
    if not audio_path.is_file():
        errors.append(f'Missing audio mix: {audio_path}')
    elif ffprobe:
        try:
            audio_info = probe(audio_path, ffprobe)
            audio_streams = [s for s in audio_info['streams'] if s['codec_type'] == 'audio']
            if len(audio_streams) != 1:
                errors.append('Audio mix must contain exactly one audio stream.')
            elif audio_streams[0].get('channels') != 2:
                errors.append('Expected a stereo trailer mix.')
            if abs(float(audio_info['format']['duration']) - DURATION) > 0.1:
                errors.append('Audio mix duration must be 40 seconds (±0.1 second).')
        except (subprocess.CalledProcessError, ValueError, KeyError) as exc:
            errors.append(f'Cannot inspect audio mix: {exc}')
    report = {
        'ready': not errors,
        'root': str(root),
        'expected_video': {'width': WIDTH, 'height': HEIGHT, 'fps': FPS,
                           'frames': FRAME_COUNT, 'duration_seconds': DURATION},
        'frames_present': present,
        'overlays': len(overlays),
        'audio_duration_seconds': audio_info.get('format', {}).get('duration'),
        'end_title_policy': 'Fade in once; remain fully visible through frame 0960.',
        'errors': errors,
    }
    return {'report': report, 'manifest': manifest, 'audio': audio_path}, errors


def build_ffmpeg_command(root: Path, manifest: dict[str, Any], output: Path,
                         ffmpeg: str, overwrite: bool, titles: bool = True) -> list[str]:
    args = [ffmpeg, '-hide_banner', '-nostdin', '-y' if overwrite else '-n',
            '-filter_complex_threads', '2', '-filter_threads', '2']
    args += ['-threads', '2', '-framerate', str(FPS), '-start_number', '1',
             '-i', str(root / 'frames' / 'frame-%04d.png')]
    overlays = manifest['overlays'] if titles else []
    for item in overlays:
        args += ['-threads', '2', '-loop', '1', '-framerate', str(FPS),
                 '-t', f'{DURATION:g}', '-i', str(root / 'titles' / item['file'])]
    audio_index = len(overlays) + 1
    args += ['-threads', '2', '-i', str(root / 'audio' / 'berigame-trailer-mix.wav')]

    # Vignette is applied to footage only. The restrained PI/10 lens angle keeps
    # character color and highlight range intact, with gentle edge darkening.
    graph = ['[0:v]setpts=PTS-STARTPTS,format=yuv420p,vignette=angle=PI/10,'
             'fade=t=in:st=0:d=0.35[v0]']
    for i, item in enumerate(overlays):
        index = i + 1
        start, end = float(item['start']), float(item['end'])
        fade_in, fade_out = float(item['fade_in']), float(item['fade_out'])
        layer = (f'[{index}:v]format=rgba,setpts=PTS-STARTPTS,'
                 f'fade=t=in:st={start:g}:d={fade_in:g}:alpha=1')
        if i < len(overlays) - 1 and fade_out > 0:
            layer += f',fade=t=out:st={end-fade_out:g}:d={fade_out:g}:alpha=1'
        layer += f'[title{index}]'
        graph.append(layer)
        graph.append(f"[v{i}][title{index}]overlay=x=0:y=0:format=yuv420:"
                     f"eof_action=pass:shortest=0:enable='between(t,{start:g},{end:g})'[v{index}]")
    graph.append(f'[v{len(overlays)}]trim=duration={DURATION:g},'
                 'setpts=PTS-STARTPTS,format=yuv420p[outv]')
    graph.append(f'[{audio_index}:a]atrim=start=0:duration={DURATION:g},'
                 f'asetpts=PTS-STARTPTS,apad=whole_dur={DURATION:g}[outa]')
    args += ['-filter_complex', ';'.join(graph), '-map', '[outv]', '-map', '[outa]',
             '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '17',
             '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', str(FPS),
             '-frames:v', str(FRAME_COUNT), '-t', f'{DURATION:g}',
             '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
             '-movflags', '+faststart', '-map_metadata', '-1',
             '-metadata', 'title=BeriGame — Little island. Giant adventures.',
             '-metadata', 'comment=Cinematic trailer', str(output)]
    return args


def encoded_frame(output: Path, ffmpeg: str, seconds: float | None = None,
                  final: bool = False, thumb: bool = False) -> Image.Image:
    args = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-threads', '2', '-filter_threads', '2']
    if seconds is not None and not final:
        args += ['-ss', f'{seconds:.6f}']
    args += ['-i', str(output)]
    filters = []
    if final:
        filters.append(f'select=eq(n\\,{FRAME_COUNT-1})')
    if thumb:
        filters.append('scale=640:360:flags=lanczos')
    if filters:
        args += ['-vf', ','.join(filters)]
    args += ['-frames:v', '1', '-an', '-threads', '2', '-c:v', 'png',
             '-f', 'image2pipe', 'pipe:1']
    result = subprocess.run(args, check=True, capture_output=True)
    with Image.open(io.BytesIO(result.stdout)) as im:
        return im.convert('RGB')


def verify_and_make_qa(output: Path, ffmpeg: str, ffprobe: str) -> dict[str, str]:
    metadata = probe(output, ffprobe)
    video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    audio = next(s for s in metadata['streams'] if s['codec_type'] == 'audio')
    expected = {'codec_name': 'h264', 'width': WIDTH, 'height': HEIGHT,
                'pix_fmt': 'yuv420p', 'r_frame_rate': f'{FPS}/1', 'nb_frames': str(FRAME_COUNT)}
    errors = [f'{key}: expected {value!r}, got {video.get(key)!r}'
              for key, value in expected.items() if video.get(key) != value]
    if abs(float(metadata['format']['duration']) - DURATION) > 0.05:
        errors.append(f'Unexpected encoded duration: {metadata["format"]["duration"]}')
    if audio.get('codec_name') != 'aac' or audio.get('channels') != 2:
        errors.append('Encoded audio must be AAC stereo.')
    metadata_path = output.with_suffix('.ffprobe.json')
    metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    if errors:
        raise RuntimeError('Encoded output validation failed: ' + '; '.join(errors))

    cell_w, image_h, label_h = 640, 360, 38
    sheet = Image.new('RGB', (cell_w * 3, (image_h + label_h) * 3), (13, 27, 20))
    draw = ImageDraw.Draw(sheet)
    try:
        label_font = ImageFont.truetype('/System/Library/Fonts/Avenir Next.ttc', 19, index=5)
    except OSError:
        label_font = ImageFont.load_default()
    for i, seconds in enumerate(SAMPLE_TIMES):
        frame = encoded_frame(output, ffmpeg, seconds=seconds, thumb=True)
        x, y = (i % 3) * cell_w, (i // 3) * (image_h + label_h)
        sheet.paste(frame, (x, y))
        draw.text((x + 14, y + image_h + 7), f'{seconds:04.1f}s / encoded MP4',
                  font=label_font, fill=(240,228,197))
    contact_path = output.with_suffix('.contact-sheet.jpg')
    sheet.save(contact_path, quality=94, subsampling=0)
    # Select by frame index so this is the actual final video frame, not a nearby
    # seek approximation. The end title is deliberately fully opaque here.
    final_path = output.with_suffix('.final-frame.png')
    encoded_frame(output, ffmpeg, final=True).save(final_path)
    return {'video': str(output), 'metadata': str(metadata_path),
            'contact_sheet': str(contact_path), 'final_frame': str(final_path)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check-only', action='store_true', help='Validate inputs only; never encode or write files.')
    parser.add_argument('--also-textless', action='store_true', help='Also encode an independent master without titles.')
    parser.add_argument('--overwrite', action='store_true', help='Allow replacing existing output MP4 and QA files.')
    args = parser.parse_args()
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    inputs, errors = inspect_inputs(ROOT, ffprobe)
    if not ffmpeg:
        errors.append('ffmpeg was not found on PATH.')
    if not ffprobe:
        errors.append('ffprobe was not found on PATH.')
    inputs['report']['ready'] = not errors
    print(json.dumps(inputs['report'], indent=2), flush=True)
    if args.check_only:
        return 0 if not errors else 2
    if errors:
        print('Inputs are incomplete; no encode was started.', file=sys.stderr)
        return 2
    outputs = [(ROOT / OUTPUT_NAME, True)]
    if args.also_textless:
        outputs.append((ROOT / 'berigame-cinematic-trailer-textless-1080p.mp4', False))
    # Validate every destination before writing any output, so a textless name
    # collision cannot surface after the main export has already been encoded.
    if not args.overwrite:
        occupied = [str(p) for output, _ in outputs for p in
                    (output, output.with_suffix('.ffprobe.json'),
                     output.with_suffix('.contact-sheet.jpg'), output.with_suffix('.final-frame.png'))
                    if p.exists()]
        if occupied:
            print('Output already exists; pass --overwrite to replace:\n' + '\n'.join(occupied), file=sys.stderr)
            return 2
    results = []
    for output, titles in outputs:
        command = build_ffmpeg_command(ROOT, inputs['manifest'], output, ffmpeg, args.overwrite, titles)
        subprocess.run(command, check=True)
        results.append(verify_and_make_qa(output, ffmpeg, ffprobe))
    print(json.dumps({'finished': results}, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (subprocess.CalledProcessError, RuntimeError, OSError, ValueError) as exc:
        print(f'Finishing failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
