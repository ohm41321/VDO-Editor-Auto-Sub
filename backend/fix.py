import sys

with open('main.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

lines[170] = '                {"role": "system", "content": "You are a professional Thai subtitle proofreader. Correct spelling and grammar errors only. Keep English words intact. DO NOT summarize. Output ONLY the corrected text without quotes or explanations."},\n'
lines[171] = '                {"role": "user", "content": text}\n'

with open('main.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)
