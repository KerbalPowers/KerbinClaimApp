using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LayerToggle : MonoBehaviour
{
    private MeshRenderer plane;
    private bool planeEnabled = true;

    [SerializeField] GameObject Disable1;
    [SerializeField] GameObject Disable2;
    [SerializeField] bool DisableOthers = false;

    void Start()
    {
        plane = GetComponent<MeshRenderer>();
        DisablePlane();
    }

    public void TogglePlane()
    {
        if (planeEnabled)
        {
            DisablePlane();
        }
        else
        {
            EnablePlane();
        }
    }

    public void EnablePlane()
    {
        if (DisableOthers) 
        {
        Disable1.GetComponent<LayerToggle>().DisablePlane();
        Disable2.GetComponent<LayerToggle>().DisablePlane();
        }
        plane.enabled = true;
        planeEnabled = true;
    }
    public void DisablePlane()
    {
        plane.enabled = false;
        planeEnabled = false;
    }
}
