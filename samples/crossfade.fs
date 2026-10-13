/*{
    "DESCRIPTION": "ISF transition demonstrating the startImage / endImage / progress convention, with an optional per-pixel dissolve.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Transition"
    ],
    "INPUTS": [
        {
            "NAME": "startImage",
            "TYPE": "image",
            "LABEL": "Start"
        },
        {
            "NAME": "endImage",
            "TYPE": "image",
            "LABEL": "End"
        },
        {
            "NAME": "progress",
            "TYPE": "float",
            "LABEL": "Progress",
            "DEFAULT": 0.0,
            "MIN": 0.0,
            "MAX": 1.0
        },
        {
            "NAME": "softness",
            "TYPE": "float",
            "LABEL": "Softness",
            "DEFAULT": 0.2,
            "MIN": 0.001,
            "MAX": 1.0
        },
        {
            "NAME": "dissolve",
            "TYPE": "bool",
            "LABEL": "Dissolve",
            "DEFAULT": false
        }
    ]
}*/

void main()
{
    vec4 start = IMG_NORM_THIS_PIXEL(startImage);
    vec4 end = IMG_NORM_THIS_PIXEL(endImage);
    float p = clamp(progress, 0.0, 1.0);
    float m = p;

    if (dissolve) {
        float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        m = smoothstep(noise - softness, noise + softness, p);
    }

    gl_FragColor = mix(start, end, m);
}
