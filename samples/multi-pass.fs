/*{
    "DESCRIPTION": "Three-pass render with WIDTH/HEIGHT equations: full-resolution copy, half-resolution blur, quarter-resolution posterize, then a final pass draws the last target to screen.",
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
            "NAME": "levels",
            "TYPE": "float",
            "LABEL": "Posterize levels",
            "DEFAULT": 4.0,
            "MIN": 2.0,
            "MAX": 12.0
        }
    ],
    "PASSES": [
        {
            "TARGET": "halfImage",
            "WIDTH": "floor($WIDTH/2.0)",
            "HEIGHT": "floor($HEIGHT/2.0)"
        },
        {
            "TARGET": "quarterImage",
            "WIDTH": "floor($WIDTH/4.0)",
            "HEIGHT": "floor($HEIGHT/4.0)"
        },
        {}
    ]
}*/

void main()
{
    if (PASSINDEX == 0) {
        gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord);
    } else if (PASSINDEX == 1) {
        vec4 sum = IMG_NORM_THIS_PIXEL(halfImage);
        sum += IMG_NORM_PIXEL(halfImage, isf_FragNormCoord + vec2(0.006, 0.0));
        sum += IMG_NORM_PIXEL(halfImage, isf_FragNormCoord - vec2(0.006, 0.0));
        sum += IMG_NORM_PIXEL(halfImage, isf_FragNormCoord + vec2(0.0, 0.006));
        sum += IMG_NORM_PIXEL(halfImage, isf_FragNormCoord - vec2(0.0, 0.006));
        gl_FragColor = sum / 5.0;
    } else {
        vec4 color = IMG_NORM_THIS_PIXEL(quarterImage);
        gl_FragColor = floor(color * levels + 0.5) / levels;
    }
}
