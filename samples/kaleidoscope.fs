/*{
    "DESCRIPTION": "Classic ISF image filter: mirrors and repeats the input image around a centre point. Demonstrates the inputImage convention and IMG_NORM_PIXEL().",
    "CREDIT": "docsify-isf self-test (after VIDVOX Kaleidoscope)",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Filter"
    ],
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image",
            "LABEL": "Input image"
        },
        {
            "NAME": "sides",
            "TYPE": "float",
            "LABEL": "Sides",
            "DEFAULT": 6.0,
            "MIN": 1.0,
            "MAX": 32.0
        },
        {
            "NAME": "angle",
            "TYPE": "float",
            "LABEL": "Angle",
            "DEFAULT": 0.0,
            "MIN": -1.0,
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
            "NAME": "slidex",
            "TYPE": "float",
            "LABEL": "Slide X",
            "DEFAULT": 0.0,
            "MIN": -1.0,
            "MAX": 1.0
        },
        {
            "NAME": "slidey",
            "TYPE": "float",
            "LABEL": "Slide Y",
            "DEFAULT": 0.0,
            "MIN": -1.0,
            "MAX": 1.0
        }
    ]
}*/

void main()
{
    float aspect = RENDERSIZE.x / max(RENDERSIZE.y, 1.0);
    vec2 p = isf_FragNormCoord - center;
    p.x *= aspect;

    float radius = length(p);
    float a = atan(p.y, p.x) + angle * 3.14159265;
    float segment = 6.28318530718 / max(sides, 1.0);
    a = mod(a, segment);
    a = abs(a - segment * 0.5);

    vec2 uv = vec2(cos(a), sin(a)) * radius;
    uv.x /= aspect;
    uv += center + vec2(slidex, slidey);

    gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
}
