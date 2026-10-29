/*{
    "DESCRIPTION": "Pass-through image sampling. The orientation regression test feeds a known 4-quadrant image and checks the canvas corners.",
    "CREDIT": "docsify-isf tests",
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
        }
    ]
}*/

void main()
{
    gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord);
}
