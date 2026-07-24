# Vendored from alexopus/ComfyUI-Image-Saver (originally giriss/comfy-image-saver),
# MIT License, Copyright (c) 2023 Girish Gopaul. See NOTICE.
import hashlib
import os
from pathlib import Path
from tqdm import tqdm

def get_sha256(file_path: str) -> str:
    """
    Given the file path, finds a matching sha256 file, or creates one
    based on the headers in the source file
    """
    file_no_ext = os.path.splitext(file_path)[0]
    hash_file = file_no_ext + ".sha256"

    if os.path.exists(hash_file):
        try:
            with open(hash_file, "r") as f:
                return f.read().strip()
        except OSError as e:
            print(f"ComfyUI-Mottoes: Error reading existing hash file: {e}")

    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        file_size = os.fstat(f.fileno()).st_size
        block_size = 1048576 # 1 MB

        print(f"ComfyUI-Mottoes: Calculating sha256 for '{Path(file_path).stem}'")
        with tqdm(None, None, file_size, unit="B", unit_scale=True, unit_divisor=1024) as progress_bar:
            for byte_block in iter(lambda: f.read(block_size), b""):
                progress_bar.update(len(byte_block))
                sha256_hash.update(byte_block)

    try:
        with open(hash_file, "w") as f:
            f.write(sha256_hash.hexdigest())
    except OSError as e:
        print(f"ComfyUI-Mottoes: Error writing hash to {hash_file}: {e}")

    return sha256_hash.hexdigest()
