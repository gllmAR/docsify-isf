/*{
    "DESCRIPTION": "Exercises every ISF input type at once: image, audio, audioFFT, float, bool, long, point2D, color and event. The bottom band shows the synthetic waveform, the top band the synthetic FFT.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ],
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image",
            "LABEL": "Image"
        },
        {
            "NAME": "wave",
            "TYPE": "audio",
            "LABEL": "Audio",
            "MAX": 256
        },
        {
            "NAME": "spectrum",
            "TYPE": "audioFFT",
            "LABEL": "Audio FFT",
            "MAX": 256
        },
        {
            "NAME": "level",
            "TYPE": "float",
            "LABEL": "Level",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 2.0
        },
        {
            "NAME": "mirror",
            "TYPE": "bool",
            "LABEL": "Mirror X",
            "DEFAULT": false
        },
        {
            "NAME": "mode",
            "TYPE": "long",
            "LABEL": "Mode",
            "DEFAULT": 0,
            "VALUES": [0, 1, 2],
            "LABELS": ["UV bars", "Checker", "Rings"]
        },
        {
            "NAME": "offset",
            "TYPE": "point2D",
            "LABEL": "Offset",
            "DEFAULT": [0.0, 0.0],
            "MIN": [-0.5, -0.5],
            "MAX": [0.5, 0.5]
        },
        {
            "NAME": "tint",
            "TYPE": "color",
            "LABEL": "Tint",
            "DEFAULT": [1.0, 1.0, 1.0, 1.0]
        },
        {
            "NAME": "flash",
            "TYPE": "event",
            "LABEL": "Flash"
        }
    ]
}*/

void main()
{
    vec2 uv = isf_FragNormCoord;
    if (mirror) uv.x = 1.0 - uv.x;
    uv += offset * 0.5;

    vec3 base;
    if (mode == 0) {
        base = vec3(uv, 0.5 + 0.5 * sin(TIME + uv.x * 12.0));
    } else if (mode == 1) {
        base = vec3(fract(uv.x * 8.0), fract(uv.y * 8.0), 0.35);
    } else {
        base = vec3(0.5 + 0.5 * sin(length(uv - 0.5) * 40.0 - TIME * 2.0));
    }

    vec3 image = IMG_NORM_PIXEL(inputImage, uv).rgb;
    base = mix(base, image, 0.45);

    vec3 waveColor = IMG_NORM_PIXEL(wave, vec2(uv.x, 0.5)).rgb;
    vec3 fftColor = IMG_NORM_PIXEL(spectrum, vec2(uv.x, 0.5)).rgb;
    if (uv.y < 0.22) base = mix(base, waveColor, 0.85);
    if (uv.y > 0.78) base = mix(base, fftColor, 0.85);

    base *= level;
    base *= tint.rgb;
    if (flash) base = vec3(1.0);

    gl_FragColor = vec4(base, 1.0);
}
