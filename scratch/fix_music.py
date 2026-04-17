import json
import os

filepath = 'public/lottie/player music.json'

def revert_gold_to_black(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == 'k' and isinstance(value, list) and len(value) == 4 and all(isinstance(x, (int, float)) for x in value):
                r, g, b, a = value
                # Check if it is the Gold color we set previously
                # [0.98, 0.725, 0.145]
                # Allow minor precision float errors
                if abs(r - 0.98) < 0.05 and abs(g - 0.725) < 0.05 and abs(b - 0.145) < 0.05:
                    obj[key] = [0.0, 0.0, 0.0, a]
                    continue
            else:
                revert_gold_to_black(value)
    elif isinstance(obj, list):
        for item in obj:
            revert_gold_to_black(item)

if os.path.exists(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print("Modifying player music.json...")
    revert_gold_to_black(data)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    print("Done.")
else:
    print("File not found.")
