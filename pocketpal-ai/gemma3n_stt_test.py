#!/usr/bin/env python3
"""
Quick test for Gemma 3n audio → text using Hugging Face Transformers.

Usage:
  python scripts/gemma3n_stt_quicktest.py \
      --model_id google/gemma-3n-E2B-it \
      --audio data/audio_samples/your_clip.wav \
      --task stt \
      --max_new_tokens 128

Tasks:
  stt  = transcribe the audio (default)
  ast  = speech translation (to English by default; use --target_lang to change)

Requirements:
  pip install "transformers>=4.56.0" torch accelerate sentencepiece safetensors \
              soundfile librosa ffmpeg-python huggingface_hub
"""

import argparse
import os
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import librosa
import torch
from transformers import AutoProcessor
from transformers import Gemma3nForConditionalGeneration

# ---------- helpers ----------

def load_and_optionally_resample(path: str, sr: int = 16000, mono: bool = True):
    """
    Load audio with soundfile; if needed, resample to 16k mono float32.
    Returns (np.ndarray float32, int sample_rate).
    """
    wav, in_sr = sf.read(path, dtype="float32", always_2d=False)
    if mono and wav.ndim == 2:
        wav = wav.mean(axis=1)
    if in_sr != sr:
        wav = librosa.resample(wav, orig_sr=in_sr, target_sr=sr)
        in_sr = sr
    # clip to [-1, 1] just in case
    wav = np.clip(wav, -1.0, 1.0).astype("float32")
    return wav, in_sr


def format_messages_for_task(audio_path_or_array, task: str, target_lang: str):
    """
    Build the multimodal chat message for Gemma 3n.

    For HF multimodal chat, the 'content' list can include items like:
      {"type": "audio", "path": "..."}  OR {"type": "audio", "url": "..."}
      {"type": "text", "text": "..."}
    We’ll pass a local file path by default.  (See Voxtral example patterns.)  # noqa
    """
    if isinstance(audio_path_or_array, (str, Path)):
        audio_item = {"type": "audio", "path": str(audio_path_or_array)}
    else:
        # Decoded audio array fallback (rarely needed; processors can accept these).
        audio_item = {"type": "audio", "audio": audio_path_or_array}

    if task == "ast":
        prompt = f"Please transcribe and translate this speech into {target_lang}."
    else:
        prompt = "Please transcribe this audio."

    messages = [
        {
            "role": "user",
            "content": [
                audio_item,
                {"type": "text", "text": prompt},
            ],
        }
    ]
    return messages


def decode_only_new_tokens(processor, outputs, inputs):
    """
    Strip the prompt from decoded text and return only the generated portion.
    Pattern: decode outputs[:, input_len:] then skip special tokens.
    """
    input_len = inputs["input_ids"].shape[-1]
    text = processor.batch_decode(
        outputs[:, input_len:], skip_special_tokens=True
    )[0].strip()
    return text


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_id", type=str, default="google/gemma-3n-E2B-it",
                        help="Gemma 3n instruction-tuned checkpoint (E2B/E4B).")
    parser.add_argument("--audio", type=str, required=True,
                        help="Path to a WAV/MP3 audio file.")
    parser.add_argument("--task", type=str, choices=["stt", "ast"], default="stt",
                        help="stt = transcribe, ast = translate speech to text.")
    parser.add_argument("--target_lang", type=str, default="English",
                        help="Target language for AST (translation).")
    parser.add_argument("--max_new_tokens", type=int, default=128)
    parser.add_argument("--dtype", type=str, default="auto",
                        help='torch dtype: "auto", "bfloat16", or "float16"')
    parser.add_argument("--device_map", type=str, default="auto",
                        help='e.g., "auto" or "cuda:0" if you want to force a device.')
    parser.add_argument("--resample_locally", action="store_true",
                        help="If set, resample to 16k mono float32 and use the in-memory array.")
    args = parser.parse_args()

    # Resolve dtype
    dtype = "auto"
    if args.dtype.lower() in {"bfloat16", "bf16"}:
        dtype = torch.bfloat16
    elif args.dtype.lower() in {"float16", "fp16", "half"}:
        dtype = torch.float16

    # Load model & processor
    print(f"[info] loading model: {args.model_id}")
    model = Gemma3nForConditionalGeneration.from_pretrained(
        args.model_id,
        device_map=args.device_map,
        torch_dtype=dtype,
    )
    processor = AutoProcessor.from_pretrained(args.model_id)

    # Audio: either pass a path for the processor to load, or resample and pass array
    audio_path = Path(args.audio)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if args.resample_locally:
        wav, sr = load_and_optionally_resample(str(audio_path), sr=16000, mono=True)
        audio_for_messages = wav
        duration = len(wav) / 16000.0
        print(f"[info] loaded & resampled locally: 16kHz mono float32, duration={duration:.2f}s")
    else:
        # Let HF processor load/convert; we still peek duration for logging.
        try:
            wav, sr = sf.read(str(audio_path), dtype="float32", always_2d=False)
            if wav.ndim == 2:
                wav = wav.mean(axis=1)
            duration = len(wav) / float(sr)
        except Exception:
            duration = float("nan")
        audio_for_messages = str(audio_path)
        print(f"[info] passing path to processor; detected duration≈{duration:.2f}s")

    # Build chat messages for the selected task
    messages = format_messages_for_task(audio_for_messages, args.task, args.target_lang)

    # Turn messages into model inputs (tokenized text + preprocessed audio features)
    # This is the recommended pattern for multimodal models.                       # noqa
    # Expect keys like: input_ids, attention_mask, and audio feature tensors.      # noqa
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    # Move to model device and appropriate dtype
    inputs = inputs.to(model.device, dtype=(model.dtype if dtype == "auto" else dtype))

    # --- Measure TTFT approximation (1-token generate) ---
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    t0 = time.time()
    ttft_out = model.generate(**inputs, max_new_tokens=1, do_sample=False)
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    ttft = time.time() - t0

    # --- Full generation ---
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    t1 = time.time()
    outputs = model.generate(
        **inputs,
        max_new_tokens=args.max_new_tokens,
        do_sample=False,
    )
    torch.cuda.synchronize() if torch.cuda.is_available() else None
    total = time.time() - t1

    # Decode only newly generated text (strip the prompt)
    text = decode_only_new_tokens(processor, outputs, inputs)

    # Report
    model_device = str(model.device)
    effective_dtype = str(model.dtype)
    print("\n" + "=" * 80)
    print("[Gemma-3n audio → text result]")
    print(f"model: {args.model_id}")
    print(f"device: {model_device}   dtype: {effective_dtype}")
    print(f"audio: {audio_path}   duration≈{duration:.2f}s   task={args.task}")
    print(f"TTFT (≈first token): {ttft:.3f}s")
    print(f"Total generation:    {total:.3f}s  (max_new_tokens={args.max_new_tokens})")
    print("-" * 80)
    print(text)
    print("=" * 80)


if __name__ == "__main__":
    main()