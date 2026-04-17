import json
import os

def walk_and_recolor(obj):
    if isinstance(obj, dict):
        # Look for color object in Lottie schema. It's usually "k" array of length 4 under "c"
        # Example: "c": {"a": 0, "k": [0, 0, 0, 1]}
        for key, value in obj.items():
            if key == 'k' and isinstance(value, list) and len(value) == 4 and all(isinstance(x, (int, float)) for x in value):
                r, g, b, a = value
                
                # Check if it's Black (or very dark) -> turn to White
                if r < 0.2 and g < 0.2 and b < 0.2:
                    obj[key] = [1.0, 1.0, 1.0, a]
                    continue
                
                # Check if it's White (or very light) -> turn to Gold/Yellow
                # Gold/Yellow accent: #C0B283 roughly [0.98, 0.725, 0.145]
                if r > 0.8 and g > 0.8 and b > 0.8:
                    obj[key] = [0.98, 0.725, 0.145, a]
                    continue
            else:
                walk_and_recolor(value)
    elif isinstance(obj, list):
        for item in obj:
            walk_and_recolor(item)

lottie_dir = 'public/lottie'
for filename in os.listdir(lottie_dir):
    if filename.endswith('.json'):
        filepath = os.path.join(lottie_dir, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        walk_and_recolor(data)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        
        print(f"Recolored: {filename}")
