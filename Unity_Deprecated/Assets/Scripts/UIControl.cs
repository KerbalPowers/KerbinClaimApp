using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using System;

public class UIControl : MonoBehaviour
{

    // Values made accessible
    public int mapModeValue = 0;

    public GameObject claimsMap;
    public GameObject claimPanel;
    public GameObject claimContextPanel;
    public GameObject inspectContextPanel;
    public GameObject provincePanel;
    public GameObject tilePanel;

    public GameObject claimDataField;
    public GameObject claimSaveMessagePanel;

    public GameObject claimExportedPanel;
    public Toggle claimOverlapToggle;
    public Slider exportImportProgressbar;

    public GameObject inspectTileDataField;
    public GameObject inspectProvinceDataField;

    public GameObject fillFullBar;
    public Slider fillSlider;
    public GameObject fillPercentageText;


    private Dictionary<string, int> speakingPopulation = new Dictionary<string, int>();

    [SerializeField] ClickDetect cd;

    // Start is called before the first frame update
    public void Exit()
    {
        Application.Quit();
    }

    public void UpdateClaimUI(float claimBar, string displayData)
    {
        if (claimBar > 1)
        {
            fillFullBar.SetActive(true);
        }
        else
        {
            fillFullBar.SetActive(false);
            fillSlider.value = claimBar;
        }

        fillPercentageText.GetComponent<TextMeshProUGUI>().text = (claimBar * 100).ToString("N1") + "%";

        claimDataField.GetComponent<TextMeshProUGUI>().text = displayData;
    }

    public void UpdateImportProgress(int progress)
    {
        exportImportProgressbar.value = progress;

        if (progress == 0 || progress == 6474)
        {
            exportImportProgressbar.gameObject.SetActive(false);
        }
        else
        {
            exportImportProgressbar.gameObject.SetActive(true);
            exportImportProgressbar.value = progress;
        }
    }

    //Show a user message so they saved
    public void StartSaveMessage()
    {
        claimSaveMessagePanel.SetActive(true);
    }

    public void EndSaveMessage()
    {
        claimSaveMessagePanel.SetActive(false);
    }
    public void UpdateInspectUI(bool showProvince, ProvinceData p, TileData t)
    {
        if (showProvince) 
        { 
            provincePanel.SetActive(true);

            // Get culture percentiles
            string percentiles = "";
            // Count populations of each subgroup definition
            foreach (TileData tp in p.Tiles)
            {
                string SubGroup = cd.FindCulture(tp.Culture).SubGroup;
                if (speakingPopulation.ContainsKey(SubGroup))
                {
                    speakingPopulation[SubGroup] += tp.Population;
                }
                else
                {
                    speakingPopulation[SubGroup] = tp.Population;
                }
            }

            // For each value in the dictionary slap it onto the bottom of the printout
            foreach (KeyValuePair<string, int> entry in speakingPopulation)
            {
                string thisPercent = ((entry.Value / (float)p.Population) * 100f).ToString("N1");
                percentiles += entry.Key + "\n(" + thisPercent + "%)\n";
            }

            string provData = ""
                + cd.selectedProvName + "\n\n"
                + p.Tiles.Count + "\n\n"
                + p.Area.ToString("N0") + "km^2\n\n" 
                + p.Population.ToString("N0") + "\n\n"
                + cd.selectedContName + "\n\n"
                + percentiles;

            inspectProvinceDataField.GetComponent<TextMeshProUGUI>().text = provData;
            speakingPopulation.Clear();
        }
        else
        {
            provincePanel.SetActive(false);
        }

        tilePanel.SetActive(true);

        string tileResources = "None";
        if (t.LocalResources.Count > 0) 
        {
            tileResources = "";
            foreach(ResourceDef r in t.LocalResources) 
            {
                tileResources += r.Resource + " (" + r.Yield + ")\n";
            }
        }

        string tileData = ""
                + t.Area.ToString("N0") + "km^2\n\n"
                + t.Coordinates.x.ToString("N3") + "°N\n" + t.Coordinates.y.ToString("N3") + "°E\n\n"
                + t.Terrain + "\n\n"
                + t.Population.ToString("N0") + "\n\n"
                + cd.selectedTileCulture.Dialect + "\n(" + cd.selectedTileCulture.Language  + ")" + "\n\n"
                + t.GDP.ToString("N0") + "r\n\n"
                + tileResources;
        inspectTileDataField.GetComponent<TextMeshProUGUI>().text = tileData;

    }

    public void onDropdownValueChanged(int value)
    {
        mapModeValue = value;
        switch(mapModeValue) 
        {
            case 0:
                tilePanel.SetActive(false);
                provincePanel.SetActive(false);
                inspectContextPanel.SetActive(true);
                claimPanel.SetActive(false);
                claimContextPanel.SetActive(false);
                claimExportedPanel.SetActive(false);
                claimsMap.SetActive(false);
                break;
            case 1:
                tilePanel.SetActive(false);
                provincePanel.SetActive(false);
                inspectContextPanel.SetActive(false);
                claimPanel.SetActive(true);
                claimContextPanel.SetActive(true);
                claimExportedPanel.SetActive(true);
                claimsMap.SetActive(true);
                break;
            case 3:
                tilePanel.SetActive(false);
                provincePanel.SetActive(false);
                inspectContextPanel.SetActive(false);
                claimPanel.SetActive(false);
                claimContextPanel.SetActive(false);
                claimExportedPanel.SetActive(false);
                claimsMap.SetActive(false);
                break;
            default:
                tilePanel.SetActive(false);
                provincePanel.SetActive(false);
                inspectContextPanel.SetActive(false);
                claimPanel.SetActive(false);
                claimContextPanel.SetActive(false);
                claimExportedPanel.SetActive(false);
                claimsMap.SetActive(false);
                break;
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
