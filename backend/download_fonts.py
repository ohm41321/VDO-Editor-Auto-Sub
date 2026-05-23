import os
import urllib.request

os.makedirs('fonts', exist_ok=True)

fonts = {
    'Kanit-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Regular.ttf',
    'Prompt-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/prompt/Prompt-Regular.ttf',
    'Mitr-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/mitr/Mitr-Regular.ttf',
    'Kanit-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Bold.ttf',
    'Prompt-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/prompt/Prompt-Bold.ttf',
    'Sarabun-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Regular.ttf',
    'Sarabun-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Bold.ttf',
    'ChakraPetch-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/chakrapetch/ChakraPetch-Regular.ttf',
    'ChakraPetch-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/chakrapetch/ChakraPetch-Bold.ttf'
}

for filename, url in fonts.items():
    dest_path = os.path.join('fonts', filename)
    if os.path.exists(dest_path):
        print(f"{filename} already exists, skipping.")
        continue
    print(f"Downloading {filename}...")
    try:
        urllib.request.urlretrieve(url, dest_path)
    except Exception as e:
        print(f"Failed to download {filename}: {e}")

print("Fonts check and download completed.")
