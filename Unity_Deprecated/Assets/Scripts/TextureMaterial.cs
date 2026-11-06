using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TextureMaterial : MonoBehaviour
{
    [SerializeField] MapGen textureSource;
    // Update is called once per frame
    public void OnEnable()
    {
        Texture2D newTexture = textureSource.claimedMapTex;
        // Get the Renderer component from the target object
        Renderer targetRenderer = GetComponent<Renderer>();

        if (targetRenderer == null)
        {
            Debug.LogError("Renderer component not found on target object.");
            return;
        }

        // Ensure the target object has a material assigned
        if (targetRenderer.material == null)
        {
            Debug.LogError("Material not assigned to the target object's Renderer.");
            return;
        }

        // Set the new texture as the albedo (main texture) of the material
        targetRenderer.material.mainTexture = newTexture;
        Debug.Log("Albedo texture replaced successfully.");
    }
}
