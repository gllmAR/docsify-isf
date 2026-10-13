/*
 * Helper included by samples/included.fs through the viewer's #include
 * resolution. It is fetched relative to the .fs file (or from any directory
 * listed in `$docsify.isf.includePaths`).
 */

vec3 isfHelperPalette(float t)
{
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.66)));
}

float isfHelperPulse(float t)
{
    return 0.5 + 0.5 * sin(t * 6.28318);
}
