/*{
    "DESCRIPTION": "Persistent-buffer feedback trail. Pass 0 mixes the previous frame from the persistent float buffer with the new input; pass 1 copies the accumulator to screen. Demonstrates PERSISTENT, FLOAT and PASSINDEX.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Multi-pass"
    ],
    "INPUTS": [
        {
            "NAME": "inputImage",
            "TYPE": "image",
            "LABEL": "Input image"
        },
        {
            "NAME": "decay",
            "TYPE": "float",
            "LABEL": "Decay",
            "DEFAULT": 0.93,
            "MIN": 0.5,
            "MAX": 0.999
        },
        {
            "NAME": "zoom",
            "TYPE": "float",
            "LABEL": "Zoom",
            "DEFAULT": 1.01,
            "MIN": 0.95,
            "MAX": 1.05
        }
    ],
    "PASSES": [
        {
            "TARGET": "accum",
            "PERSISTENT": true,
            "FLOAT": true
        },
        {}
    ]
}*/

void main()
{
    if (PASSINDEX == 0) {
        vec2 uv = (isf_FragNormCoord - 0.5) / zoom + 0.5;
        vec4 previous = IMG_NORM_PIXEL(accum, uv);
        vec4 source = IMG_NORM_PIXEL(inputImage, uv);
        gl_FragColor = mix(source, previous, decay);
    } else {
        gl_FragColor = IMG_NORM_PIXEL(accum, isf_FragNormCoord);
    }
}
