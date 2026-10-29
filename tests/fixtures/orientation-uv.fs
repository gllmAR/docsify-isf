/*{
    "DESCRIPTION": "Outputs isf_FragNormCoord as (x, y). The orientation regression test checks that (0,0) is bottom-left and that captures match the canvas.",
    "CREDIT": "docsify-isf tests",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ]
}*/

void main()
{
    gl_FragColor = vec4(isf_FragNormCoord, 0.0, 1.0);
}
