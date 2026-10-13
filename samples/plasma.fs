/*{
    "DESCRIPTION": "Animated plasma generator used as the docsify-isf smoke test. Demonstrates float, bool, color, point2D, long and event inputs plus TIME and RENDERSIZE.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Generator"
    ],
    "INPUTS": [
        {
            "NAME": "speed",
            "TYPE": "float",
            "LABEL": "Speed",
            "DEFAULT": 0.4,
            "MIN": 0.0,
            "MAX": 2.0
        },
        {
            "NAME": "scale",
            "TYPE": "float",
            "LABEL": "Scale",
            "DEFAULT": 4.0,
            "MIN": 0.5,
            "MAX": 16.0
        },
        {
            "NAME": "warp",
            "TYPE": "float",
            "LABEL": "Warp",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 1.0
        },
        {
            "NAME": "center",
            "TYPE": "point2D",
            "LABEL": "Center",
            "DEFAULT": [0.5, 0.5],
            "MIN": [0.0, 0.0],
            "MAX": [1.0, 1.0]
        },
        {
            "NAME": "tint",
            "TYPE": "color",
            "LABEL": "Tint",
            "DEFAULT": [0.85, 0.45, 1.0, 1.0]
        },
        {
            "NAME": "palette",
            "TYPE": "long",
            "LABEL": "Palette",
            "DEFAULT": 0,
            "VALUES": [0, 1, 2],
            "LABELS": ["Neon", "Fire", "Ice"]
        },
        {
            "NAME": "invert",
            "TYPE": "bool",
            "LABEL": "Invert",
            "DEFAULT": false
        },
        {
            "NAME": "resetPhase",
            "TYPE": "event",
            "LABEL": "Reset phase"
        }
    ]
}*/

void main()
{
    vec2 uv = (gl_FragCoord.xy - RENDERSIZE * center) / min(RENDERSIZE.x, RENDERSIZE.y);
    float t = TIME * speed;
    float v = sin(uv.x * scale + t)
            + sin(uv.y * scale + t * 1.3)
            + sin((uv.x + uv.y) * scale * (0.5 + warp) - t * 0.7);
    v = v / 3.0 * 0.5 + 0.5;

    vec3 color;
    if (palette == 0) {
        color = 0.5 + 0.5 * cos(6.28318530718 * (v + vec3(0.0, 0.33, 0.67)));
    } else if (palette == 1) {
        color = vec3(v, v * v, pow(v, 3.0));
    } else {
        color = vec3(pow(v, 3.0), v * v, v);
    }
    color *= tint.rgb;
    if (invert) color = 1.0 - color;
    gl_FragColor = vec4(color, 1.0);
}
