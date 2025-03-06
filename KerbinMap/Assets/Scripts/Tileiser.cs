using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Enumeration;
using UnityEngine;
using UnityEngine.Tilemaps;

public class Tileiser : MonoBehaviour
{

    private Color clearColour;
    private Color[] clearColours;

    [SerializeField] public String fileName;
    [SerializeField] public Texture2D sourceMap;
    [SerializeField] private MapGen mapSource;
    [SerializeField] private Boolean runConvertor;
    [SerializeField] private Boolean generateHeatmap;

    private Color[] tilePixels;
    int width, height;

    // Start is called before the first frame update
    private void Start()
    {
        if (!runConvertor) return;

        if (mapSource == null || sourceMap == null)
        {
            Debug.LogError("soureMap or tileMap is not assigned.");

            return;
        }

        // Gotta store these for painting
        tilePixels = mapSource.tileMap.GetPixels();

        width = mapSource.tileMap.width;
        height = mapSource.tileMap.height;

        // Create a predefined empty image
        clearColour = new Color(0, 0, 0, 0);
        clearColours = new Color[width * height];
        for (int i = 0; i < clearColours.Length; i++)
        {
            clearColours[i] = clearColour;
        }

        StartCoroutine(TiliseMap());
    }

    IEnumerator TiliseMap()
    {
        yield return new WaitForSeconds(2.1f);
        Color[] mapMap = new Color[width * height];
        mapMap = sourceMap.GetPixels();

        yield return new WaitForSeconds(0.1f);

        Color[] mapTiles = new Color[width * height];
        Array.Copy(clearColours, mapTiles, clearColours.Length);

        yield return new WaitForSeconds(0.1f);

        int tileProgress = 0;

        foreach (ContinentData c in mapSource.continents)
        {
            foreach (ProvinceData p in c.Provinces)
            {
                foreach (TileData t in p.Tiles)
                {
                    // Use first position as the data peg if the mean position is over water
                    Vector2 position = t.Position;
                    int baseX = (int)position.x;
                    int baseY = (int)position.y;

                    // Get altitude by converting the heightmap brightness
                    Color sampleValue = mapMap[baseY * width + baseX];

                    //Modify the colour to export only one channel
                    if (generateHeatmap)
                    {
                        sampleValue = GenerateHeatmapColor(sampleValue); // new Color(0f, 0f, sampleValue.b); 
                    }

                    PaintTile(t, mapTiles, sampleValue);
                    tileProgress++;
                    Debug.Log("Painted " + tileProgress + "/ 6474");
                }
                yield return new WaitForSeconds(0.1f);

            }
        }

        yield return new WaitForSeconds(1.1f);

        // Initialize the hightlight Texture with the same dimensions as the map image
        Texture2D mapTexture = new Texture2D(width, height, TextureFormat.ARGB32, false);

        yield return new WaitForSeconds(0.1f);

        // Set the map to the currently stored highlights array
        mapTexture.SetPixels(0, 0, width, height, mapTiles);
        mapTexture.Apply();
        // Save the final texture to a file 
        string filePath = $"{Application.streamingAssetsPath}/Exports/{fileName}.png";
        byte[] pngBytes = mapTexture.EncodeToPNG();
        File.WriteAllBytes(filePath, pngBytes);

        yield return null;
    }

    Color GenerateHeatmapColor(Color sampleValue)
    {
        // This function generates the heatmap color based on the blue channel value
        float blueSample = Mathf.Clamp01(1- 2*(1 - sampleValue.b));


        float blueValue = Mathf.Clamp01(sampleValue.b);

        // Scale red and green based on blue value
        // Saturate red at lower blue values, desaturate as blue increases
        float redValue = Mathf.Clamp01(blueSample);  // Decrease as blue increases
        float greenValue = Mathf.Clamp01(blueSample);  // Decrease as blue increases

        // Ensure all values are in the range [0, 1] and scale together to form the heatmap
        return new Color(redValue, greenValue, blueValue);
    }

    void PaintTile(TileData tile, Color[] targetTex, Color paintColor)
    {
        // Calculate the pixel position of the mean position
        int pixelX = Mathf.RoundToInt(tile.Position.x);
        int pixelY = Mathf.RoundToInt(tile.Position.y);
        int totalArea = tile.ProjectedArea;

        int searchOffset = 1;
        Color targetColor = tilePixels[pixelY * width + pixelX];

        // Set the mean painted
        targetTex[pixelY * width + pixelX] = paintColor;
        int foundArea = 1;

        while (foundArea < totalArea)
        {
            int startX = pixelX - searchOffset;
            int endX = pixelX + searchOffset;
            int startY = pixelY - searchOffset;
            int endY = pixelY + searchOffset;

            // Limit startY and endY to be within the texture's height boundaries
            // The heigh extremes are all icecap so won't flag as duplicates
            startY = Mathf.Clamp(startY, 0, height - 1);
            endY = Mathf.Clamp(endY, 0, height - 1);

            // Check top and bottom edges
            for (int x = startX; x <= endX; x++)
            {
                int topIndex = startY * width + x;
                int bottomIndex = endY * width + x;
                if (tilePixels[topIndex] == targetColor)
                {
                    targetTex[topIndex] = paintColor;
                    foundArea++;
                }
                if (tilePixels[bottomIndex] == targetColor)
                {
                    targetTex[bottomIndex] = paintColor;
                    foundArea++;
                }
            }

            // Check left and right edges
            for (int y = startY + 1; y < endY; y++) // Start from startY + 1 to avoid rechecking the corners
            {
                int leftIndex = y * width + startX;
                int rightIndex = y * width + endX;
                if (tilePixels[leftIndex] == targetColor)
                {
                    targetTex[leftIndex] = paintColor;
                    foundArea++;
                }
                if (tilePixels[rightIndex] == targetColor)
                {
                    targetTex[rightIndex] = paintColor;
                    foundArea++;
                }
            }

            searchOffset++;
        }
    }
}

