import os
import urllib.request

os.makedirs('fonts', exist_ok=True)

fonts = {
    'Kanit-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Regular.ttf',
    'Prompt-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/prompt/Prompt-Regular.ttf',
    'Mitr-Regular.ttf': 'https://github.com/google/fonts/raw/main/ofl/mitr/Mitr-Regular.ttf',
    'Kanit-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Bold.ttf',
    'Prompt-Bold.ttf': 'https://github.com/google/fonts/raw/main/ofl/prompt/Prompt-Bold.ttf'
}

for filename, url in fonts.items():
    print(f"Downloading {filename}...")
    urllib.request.urlretrieve(url, os.path.join('fonts', filename))

print("Fonts downloaded successfully.")
