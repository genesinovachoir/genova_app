import json
import os

def create_lottie_json(name, color=[0.98, 0.75, 0.14], shape_type="rect"):
    # Premium easing: cubic-bezier(0.4, 0, 0.2, 1)
    # Lottie uses in/out tangents. 
    # For a simple 0 to 1 range, the tangents would be:
    # out: [0.4, 0], in: [0.2, 1]
    
    lottie = {
        "v": "5.5.7",
        "fr": 60,
        "ip": 0,
        "op": 120,
        "w": 100,
        "h": 100,
        "nm": name,
        "ddd": 0,
        "assets": [],
        "layers": [
            {
                "ddd": 0,
                "ind": 1,
                "ty": 4,
                "nm": "Primary Motion",
                "sr": 1,
                "ks": {
                    "o": {"a": 0, "k": 100, "ix": 11},
                    "r": {"a": 0, "k": 0, "ix": 10},
                    "p": {"a": 0, "k": [50, 50, 0], "ix": 2},
                    "a": {"a": 0, "k": [0, 0, 0], "ix": 1},
                    "s": {
                        "a": 1,
                        "k": [
                            {
                                "i": {"x": [0.4], "y": [1]},
                                "o": {"x": [0.2], "y": [0]},
                                "t": 0,
                                "s": [95, 95, 100]
                            },
                            {
                                "i": {"x": [0.4], "y": [1]},
                                "o": {"x": [0.2], "y": [0]},
                                "t": 60,
                                "s": [105, 105, 100]
                            },
                            {
                                "t": 120,
                                "s": [95, 95, 100]
                            }
                        ],
                        "ix": 6
                    }
                },
                "ao": 0,
                "shapes": [
                    {
                        "ty": "gr",
                        "it": [
                            {
                                "ty": "rc" if shape_type == "rect" else "ov",
                                "d": 1,
                                "s": {"a": 0, "k": [40, 40], "ix": 2},
                                "p": {"a": 0, "k": [0, 0], "ix": 3},
                                "r": {"a": 0, "k": 4 if shape_type == "rect" else 0, "ix": 4},
                                "nm": "Path",
                                "mn": "ADBE Vector Shape - Rect" if shape_type == "rect" else "ADBE Vector Shape - Ellipse",
                                "hd": False
                            },
                            {
                                "ty": "fl",
                                "c": {"a": 0, "k": color + [1], "ix": 4},
                                "o": {"a": 0, "k": 60, "ix": 5},
                                "r": 1,
                                "bm": 0,
                                "nm": "Fill",
                                "mn": "ADBE Vector Graphic - Fill",
                                "hd": False
                            },
                            {
                                "ty": "tr",
                                "p": {"a": 0, "k": [0, 0], "ix": 2},
                                "a": {"a": 0, "k": [0, 0], "ix": 1},
                                "s": {"a": 0, "k": [100, 100], "ix": 3},
                                "r": {"a": 0, "k": 0, "ix": 6},
                                "o": {"a": 0, "k": 100, "ix": 7},
                                "sk": {"a": 0, "k": 0, "ix": 4},
                                "sa": {"a": 0, "k": 0, "ix": 5},
                                "nm": "Transform"
                            }
                        ],
                        "nm": "Group",
                        "np": 3,
                        "cix": 2,
                        "bm": 0,
                        "sr": 1,
                        "mn": "ADBE Vector Group",
                        "hd": False
                    }
                ],
                "ip": 0,
                "op": 120,
                "st": 0,
                "bm": 0
            }
        ]
    }
    return lottie

icons = [
    ("home", "rect"),
    ("music", "ov"),
    ("repertuvar", "rect"),
    ("odevler", "rect"),
    ("profil", "ov"),
    ("bell", "ov")
]

output_dir = "public/lottie"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

for name, shape in icons:
    data = create_lottie_json(name, shape_type=shape)
    with open(os.path.join(output_dir, f"{name}.json"), 'w') as f:
        json.dump(data, f)
    print(f"Generated {name}.json")
