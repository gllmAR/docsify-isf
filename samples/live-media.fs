/*{
    "DESCRIPTION": "Live camera and microphone showcase. Open Parameters > Media, then click Use camera and Use mic. Without devices, the image input uses the built-in test pattern and audio uses the synthetic waveform/spectrum fallback.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Showcase"
    ],
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image",
            "LABEL": "Camera"
        },
        {
            "NAME": "wave",
            "TYPE": "audio",
            "LABEL": "Waveform",
            "MAX": 256
        },
        {
            "NAME": "spectrum",
            "TYPE": "audioFFT",
            "LABEL": "Spectrum",
            "MAX": 256
        },
        {
            "NAME": "reactivity",
            "TYPE": "float",
            "LABEL": "Reactivity",
            "DEFAULT": 0.85,
            "MIN": 0.0,
            "MAX": 1.5
        },
        {
            "NAME": "tint",
            "TYPE": "color",
            "LABEL": "Accent",
            "DEFAULT": [0.35, 0.9, 1.0, 1.0]
        },
        {
            "NAME": "scanlines",
            "TYPE": "bool",
            "LABEL": "Scanlines",
            "DEFAULT": true
        }
    ]
}*/

void main()
{
    vec2 uv = isf_FragNormCoord;

    // Live camera, or the built-in test pattern until a camera/file is bound.
    vec3 camera = IMG_NORM_PIXEL(inputImage, uv).rgb;

    // Audio textures are 1×N: sample across the row at the centre height.
    float waveform = IMG_NORM_PIXEL(wave, vec2(uv.x, 0.5)).r;
    float fft = IMG_NORM_PIXEL(spectrum, vec2(uv.x, 0.5)).r;
    float bass = IMG_NORM_PIXEL(spectrum, vec2(0.04, 0.5)).r;
    float energy = (waveform + fft + bass) / 3.0;

    vec3 color = camera;
    color = mix(color, color * (0.55 + 1.1 * energy), clamp(reactivity, 0.0, 1.5));
    color += tint.rgb * (0.08 + 0.32 * fft) * reactivity;

    // Spectrum floor.
    float bars = smoothstep(0.24, 0.0, uv.y) * smoothstep(0.0, 0.04, uv.y);
    color = mix(color, tint.rgb * (0.2 + 0.9 * fft), bars * 0.7);

    // Waveform trace.
    float trace = smoothstep(0.016, 0.0, abs(uv.y - (0.84 + (waveform - 0.5) * 0.16)));
    color = mix(color, tint.rgb, trace * 0.85);

    if (scanlines) color *= 0.88 + 0.12 * step(0.5, fract(uv.y * 180.0));

    // Soft vignette keeps the camera feed readable under the audio overlays.
    vec2 aspect = vec2(RENDERSIZE.x / max(RENDERSIZE.y, 1.0), 1.0);
    color *= 1.0 - 0.22 * length((uv - 0.5) * aspect);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
