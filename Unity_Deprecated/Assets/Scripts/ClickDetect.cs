using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using TMPro;
using Unity.Properties;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Networking;
using UnityEngine.UI;

using Color = UnityEngine.Color;
using ColorUtility = UnityEngine.ColorUtility;
using Debug = UnityEngine.Debug;
using Input = UnityEngine.Input;

//this method handles click detection action and the stages involved in generating map data
public class ClickDetect : MonoBehaviour
{
    [SerializeField] private GameObject tileScanTarget;
    [SerializeField] private Material selectedMaterial;

    public string selectedProvName;
    public string selectedContName;
    public ProvinceData selectedProvince;
    public TileData selectedTile;
    public CultureDef selectedTileCulture;

    private MapGen mapSource;

    private List<CultureDef> culturesList;

    private Texture2D highlightTexture;
    private Color clearColour;
    private Color[] clearColours;
    private Color[] highlightColours;

    private Dictionary<string, int> culturalPopulation = new Dictionary<string, int>();
    private Dictionary<string, int> speakingPopulation = new Dictionary<string, int>();

    // Claim Data
    private HashSet<TileData> selectedTiles = new HashSet<TileData>();
    public float totalArea = 0;
    public int totalPopulation = 0;
    public double totalGDP = 0;
    public int claimValue = 0;
    public string claimName;
    public List<ResourceDef> resources = new List<ResourceDef>();

    [SerializeField] private int claimLimit = 750000;
    [SerializeField] private UIControl UICanvas;
    [SerializeField] GameObject nameField;

    private Color[] tilePixels;
    int width, height;

    // Start is called before the first frame update
    void Start()
    {
        mapSource = GetComponent<MapGen>();
        // Import Culture Definitions
        culturesList = mapSource.culturesList;

        // Gotta store these for painting
        tilePixels = mapSource.tileMap.GetPixels();
        
        width = mapSource.tileMap.width; 
        height = mapSource.tileMap.height;

        // Initialize the hightlight Texture with the same dimensions as the map image
        highlightTexture = new Texture2D(width, height, TextureFormat.ARGB32, false);

        // Create a predefined empty image
        clearColour = new Color(0, 0, 0, 0);
        clearColours = new Color[width * height];
        for (int i = 0; i < clearColours.Length; i++)
        {
            clearColours[i] = clearColour;
        }
        // Copy the empty aray into the highlight array by default
        highlightColours = new Color[width * height];
        Array.Copy(clearColours, highlightColours, clearColours.Length);
        UpdatePlaneTexture();

        //StartCoroutine(TiliseMap());
        LoadClaimLimit();
    }

    void Update()
    {
        bool isOverUI = EventSystem.current.IsPointerOverGameObject();

        // Check for left mouse button click
        if (Input.GetMouseButtonDown(0) && !isOverUI) 
        {
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            RaycastHit hit;

            // Perform the raycast and check for collision with the tiles
            if (Physics.Raycast(ray, out hit) && hit.collider.gameObject == tileScanTarget)
            {
                //get the position where the ray hit
                Vector2 textureCoord = hit.textureCoord;
                // Convert texture coordinates to pixel coordinates
                int x = Mathf.RoundToInt(textureCoord.x * width * 2);
                int y = Mathf.RoundToInt(textureCoord.y * height);
                GameModeLC(x, y);

            }
        }

        // Check for right mouse button click
        if (Input.GetMouseButtonDown(1) && !isOverUI)
        {
            Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            RaycastHit hit;

            // Perform the raycast and check for collision with the tiles
            if (Physics.Raycast(ray, out hit) && hit.collider.gameObject == tileScanTarget)
            {
                //get the position where the ray hit
                Vector2 textureCoord = hit.textureCoord;
                // Convert texture coordinates to pixel coordinates
                int x = Mathf.RoundToInt(textureCoord.x * width * 2);
                int y = Mathf.RoundToInt(textureCoord.y * height);
                GameModeRC(x, y);

            }
        }

    }
    public void SaveClaimLimit(int claimLimit)
    {
        Debug.Log("Writing Claim Limit to Config File");
        string newPath = Application.streamingAssetsPath + "/MapGen/Limit.json";

        int[] toSend = new int[1];
        toSend[0] = claimLimit;

        string jsonOutput = JsonHelper.ToJson<int>(toSend, true);
        File.WriteAllText(newPath, jsonOutput);
    }
    public void LoadClaimLimit()
    {
        Debug.Log("Reading Claim Limit from Config File");
        string filePath = Application.streamingAssetsPath + "/MapGen/Limit.json";
        if (File.Exists(filePath))
        {
            string content = File.ReadAllText(filePath);

                int[] loadedValues = JsonHelper.FromJson<int>(content);
                if (loadedValues.Length > 0)
                {
                    claimLimit = loadedValues[0];
                }

        } 
        else
        {
            SaveClaimLimit(750000);
        }
    }

    public void ClaimAllTiles()
    {
        StartCoroutine(ClaimAll());
    }

    IEnumerator ClaimAll()
    {
        totalArea = 0;
        totalPopulation = 0;
        claimValue = 0;
        resources.Clear();
        foreach (ContinentData c in mapSource.continents)
        {
            foreach (ProvinceData p in c.Provinces)
            {
                foreach (TileData t in p.Tiles)
                {
                    TileClaim(t, true);
                }
                yield return new WaitForSeconds(0.1f);
                string resourcesString = "none";
                if (resources.Count > 0)
                {
                    resourcesString = "";
                    foreach (ResourceDef r in resources)
                    {
                        resourcesString += r.Resource + " (" + r.Yield + ")\n";
                    }
                }
                UICanvas.UpdateClaimUI((float)claimValue / claimLimit, $"{totalArea.ToString("N0")} km^2\n\n{totalPopulation.ToString("N0")}\n\n{totalGDP.ToString("N0")}r\n\n{resourcesString}");
                UpdatePlaneTexture();
            }
        }

        Debug.Log("Selected all tiles");

        yield return null;
    }

    public void ClaimTerritory()
    {
        StartCoroutine(ClaimFromExport());
    }

    IEnumerator ClaimFromExport()
    {
        //Color[] expMap = new Color[width * height];
        //expMap = Resources.Load<Texture2D>(Application.streamingAssetsPath + "/Exports/Territory.png").GetPixels();

        string texturePath = Application.streamingAssetsPath + "/Exports/Territory.png";
        Texture2D expTexture = new Texture2D(width, height, TextureFormat.RGBA32, false);

        ImageConversion.LoadImage(expTexture, File.ReadAllBytes(texturePath));

        Color[] expMap = expTexture.GetPixels();

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

                    // Get transparency by sampling the map
                    Color sampleValue = expMap[baseY * width + baseX];

                    if (sampleValue.r > 0f)
                    {
                        TileClaim(t, true);
                    }
                    

                    tileProgress++;
                    UICanvas.UpdateImportProgress(tileProgress);
                    Debug.Log("Checked " + tileProgress + "/ 6474");
                }
                yield return new WaitForSeconds(0.1f);
            }
        }

        yield return new WaitForSeconds(0.1f); 
        string resourcesString = "none";
        if (resources.Count > 0)
        {
            resourcesString = "";
            foreach (ResourceDef r in resources)
            {
                resourcesString += r.Resource + " (" + r.Yield + ")\n";
            }
        }
        UICanvas.UpdateClaimUI((float)claimValue / claimLimit, $"{totalArea.ToString("N0")} km^2\n\n{totalPopulation.ToString("N0")}\n\n{totalGDP.ToString("N0")}r\n\n{resourcesString}");
        UpdatePlaneTexture();

        //reset progress bar
        UICanvas.UpdateImportProgress(0);

        Debug.Log("Loaded Claim from Export Folder");

        yield return null;
    }

   

    void GameModeLC (int x, int y)
    {
        int situation = UICanvas.mapModeValue;
        switch (situation)
        {
            case 0: //Inspect Mode
                bool showProvince = false;
                if (selectedTile != null) //Clear Old selection
                {
                    //Clear the whole map cause only one selection at a time
                    Array.Copy(clearColours, highlightColours, clearColours.Length);
                }
                SelectTile(x, y);
                // Retrieve the cultural index and get its full tree
                selectedTileCulture = FindCulture(selectedTile.Culture);
                // Get the localised name from the MapGen script
                selectedProvName = mapSource.RetrieveName(false, selectedTile.ProvinceParent);
                selectedContName = mapSource.RetrieveName(true, selectedTile.ContinentParent);

                // if shift clicked then highlight all tiles in province
                if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
                {
                    PaintProvince(highlightColours, Color.blue);
                    // Also show the province data
                    showProvince = true;
                }
                // Paint the main one after so it's differently coloured
                PaintTile(selectedTile, highlightColours, Color.cyan);
                UpdatePlaneTexture();

                // Pass info to UI
                UICanvas.UpdateInspectUI(showProvince, selectedProvince, selectedTile);
                break;
            case 1:
                SelectTile(x, y);
                // if shift clicked then add all tiles in province
                if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
                {
                    foreach (TileData t in selectedProvince.Tiles)
                    {
                        if (!selectedTiles.Contains(t))
                        {
                            TileClaim(t, true);
                        }
                    }
                } 
                else //else just do the one
                {
                    if (!selectedTiles.Contains(selectedTile))
                    {
                        TileClaim(selectedTile, true);
                    }
                }
                string resourcesString = "none";
                if (resources.Count > 0)
                {
                    resourcesString = "";
                    foreach (ResourceDef r in resources)
                    {
                        resourcesString += r.Resource + " (" + r.Yield + ")\n";
                    }
                }
                UICanvas.UpdateClaimUI((float)claimValue / claimLimit, $"{totalArea.ToString("N0")} km^2\n\n{totalPopulation.ToString("N0")}\n\n{totalGDP.ToString("N0")}r\n\n{resourcesString}");
                UpdatePlaneTexture();
                break;
            case 2:
                Debug.Log("Distance calc is a work in progress");
                break;
            default:
                //nothing
                break;
        }
    }
    void GameModeRC(int x, int y)
    {
        int situation = UICanvas.mapModeValue;
        switch (situation)
        {
            case 0: //Inspect Mode
                //Right click doesn't do anything
                break;
            case 1:
                SelectTile(x, y);
                // if shift clicked then add all tiles in province
                if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
                {
                    foreach (TileData t in selectedProvince.Tiles)
                    {
                        if (selectedTiles.Contains(t))
                        {
                            TileClaim(t, false);
                        }
                    }
                }
                else //else just do the one
                {
                    if (selectedTiles.Contains(selectedTile))
                    {
                        TileClaim(selectedTile, false);
                    }
                }
                string resourcesString = "none";
                if (resources.Count > 0)
                {
                    resourcesString = "";
                    foreach (ResourceDef r in resources)
                    {
                        resourcesString += r.Resource + " (" + r.Yield + ")\n";
                    }
                }
                UICanvas.UpdateClaimUI((float)claimValue / claimLimit, $"{totalArea.ToString("N0")} km^2\n\n{totalPopulation.ToString("N0")}\n\n{totalGDP.ToString("N0")}r\n\n{resourcesString}");
                UpdatePlaneTexture();
                break;
            case 2:
                Debug.Log("Distance calc is a work in progress");
                break;
            default:
                //nothing
                break;
        }
    }

    void TileClaim(TileData t, bool add)
    {
        if (add)
        {
            if(UICanvas.GetComponent<UIControl>().claimOverlapToggle.isOn)
            {
                // if the tile shows as claimed don't add it
                if (SearchTuple(t.HexCode)) return;
            }
            
            totalArea += t.Area;
            totalPopulation += t.Population;
            totalGDP += t.GDP;
            claimValue += t.ClaimValue;
            AddResource(t, false);

            PaintTile(t, highlightColours, Color.red);
            selectedTiles.Add(t);
        }
        else
        {
            totalArea -= t.Area;
            totalPopulation -= t.Population;
            totalGDP -= t.GDP;
            claimValue -= t.ClaimValue;
            AddResource(t, true);

            PaintTile(t, highlightColours, clearColour);
            selectedTiles.Remove(t);
        }
    }

    bool SearchTuple(string searchTerm)
    {
        var tuple = mapSource.claimedList.Find(t => t.Item1 == searchTerm);
        if (tuple != default((string, bool)))
        {
            return tuple.Item2;
        }
        else
        {
            Debug.LogWarning("String not found in tuple list: " + searchTerm);
            return false; // Or any default value you prefer
        }
    }

    void AddResource(TileData t, bool remove)
    {
        foreach (ResourceDef r in t.LocalResources)
        {  // Check if resources list contains a ResourceDef with the same Type
            ResourceDef existingResource = resources.Find(res => res.Resource == r.Resource);

            if (existingResource == null)
            {
                // If not found, add the new resource to the list
                resources.Add(new ResourceDef( r.Resource, r.Yield ));
            }
            else
            {
                // If found, adjust the Yield value based on the remove flag
                existingResource.Yield += remove ? -r.Yield : r.Yield;
            }
        }
    }

    public void clearSelection()
    {
        totalArea = 0;
        totalPopulation = 0;
        totalGDP = 0;
        claimValue = 0;
        selectedTiles.Clear();
        resources.Clear();

        // Add your preset entries here
        resources.Add(new ResourceDef("Food", 0));
        resources.Add(new ResourceDef("Hydrates", 0));
        resources.Add(new ResourceDef("Common Ore", 0));
        resources.Add(new ResourceDef("Rare Ore", 0));
        resources.Add(new ResourceDef("Nuclear Ore", 0));

        string resourcesString = "Food (0)\nHydrates (0)\nCommon Ore (0)\nRare Ore (0)\nNuclear Ore (0)";

        UICanvas.UpdateClaimUI(0, $"0km^2\n\n0\n\n0r\n\n0");

        Array.Copy(clearColours, highlightColours, clearColours.Length);
        UpdatePlaneTexture();
    }
    void SaveClaimData()
    {
        claimName = nameField.GetComponent<TMP_InputField>().text;

        // Get culture percentiles
        string percentiles = "";
        string languages = "";
        // Count populations of each subgroup definition
        foreach (TileData td in selectedTiles)
        {
            string SubGroup = FindCulture(td.Culture).SubGroup;
            string Language = FindCulture(td.Culture).Language;
            if (speakingPopulation.ContainsKey(Language))
            {
                speakingPopulation[Language] += td.Population;
            }
            else
            {
                speakingPopulation[Language] = td.Population;
            }

            if (culturalPopulation.ContainsKey(SubGroup))
            {
                culturalPopulation[SubGroup] += td.Population;
            }
            else
            {
                culturalPopulation[SubGroup] = td.Population;
            }
        }

        // For each value in the dictionary slap it onto the bottom of the printout
        foreach (KeyValuePair<string, int> entry in speakingPopulation)
        {
            float thisPercent = (entry.Value / (float)totalPopulation);
            if (thisPercent > 0.25f)
            {
                languages += entry.Key + "<br/>";
            }
        }

        if (languages.Equals(""))
        {
            languages = "None";
        }

        // For each value in the dictionary slap it onto the bottom of the printout
        foreach (KeyValuePair<string, int> entry in culturalPopulation)
        {
            string thisPercent = ((entry.Value / (float)totalPopulation) * 100f).ToString("N1");
            percentiles += thisPercent + "% " + entry.Key + "<br/>";
        }

        speakingPopulation.Clear();
        culturalPopulation.Clear();

        // Create a list to store the lines of the text
        List<string> lines = new List<string>();

        // Add the claim data to the list
        lines.Add("{{Nation");
        lines.Add("| nation = " + claimName);
        lines.Add("| localized_name = ");
        lines.Add("| full_name = " + claimName);
        lines.Add("| flag = " + claimName + "_flag.png");
        lines.Add("| flagdesc = Flag of " + claimName);
        lines.Add("| motto = " + "[Unknown]");
        lines.Add("| anthem = " + "[Unknown]");
        lines.Add("| anthem_MP3 = " + "[Unknown.mp3]");
        lines.Add("| map = " + claimName + "_Globe.png");
        lines.Add("| mapdesc = " + "Map of " + claimName);
        lines.Add("| denonym = " + claimName + "ian");
        lines.Add("| capital = " + mapSource.RetrieveName(false, selectedTile.ProvinceParent));
        lines.Add("| languages = " + languages);
        lines.Add("| currency = " + claimName + "ian Fund");
        lines.Add("| government = " + "[Unknown]");
        //lines.Add("| foundation = " + GetDate(DateTime.UtcNow));
        lines.Add("| ethnicity = " + percentiles);
        lines.Add("| population = " + totalPopulation.ToString("N0"));
        lines.Add("| area = " + totalArea.ToString("N0"));
        lines.Add("| predecessor = ");
        lines.Add("| successor = ");
        lines.Add("}}");

        // Add an empty line after the claim data
        lines.Add("");

        lines.Add("Population Density: " + (totalPopulation / totalArea).ToString("N2") + "/km^2");
        lines.Add("GDP (Nominal): " + totalGDP.ToString("N0") + "r");
        lines.Add("");

        lines.Add("Resources");
        lines.Add("Population (" + totalPopulation + ")");
        foreach (ResourceDef r in resources)
        {
            lines.Add(r.Resource + " (" + r.Yield + ")");
        }
        lines.Add("");
        // Add the selectedTiles hashset to the list
        lines.Add("Claim Value: " + claimValue.ToString("N0") + "/" + claimLimit.ToString("N0"));

        // Save the lines to a file 
        string filePath = Application.streamingAssetsPath + "/Exports/Claim.txt";
        File.WriteAllLines(filePath, lines);
    }

    public void exportClaim()
    {
        SaveClaimData();
        PrintMap("Territory.png");
    }


    #region Painters

    public void UpdatePlaneTexture()
    {
        // Set the map to the currently stored highlights array
        highlightTexture.SetPixels(0, 0, width, height, highlightColours);
        highlightTexture.Apply();

        // Update the visible plane material for the new highlight
        selectedMaterial.mainTexture = highlightTexture;
    }

    void PrintMap(string filename)
    {
        // Save the final texture to a file 
        string filePath = Application.streamingAssetsPath + "/Exports/" + filename;
        byte[] pngBytes = highlightTexture.EncodeToPNG();
        File.WriteAllBytes(filePath, pngBytes);
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

    void PaintProvince(Color[] targetTex, Color paintColor)
    {
        foreach (TileData t in selectedProvince.Tiles) 
        {
            PaintTile(t, targetTex, paintColor);
        }
    }
    #endregion

    #region Finders

    public DateTime GetDate(DateTime inputDate)
    { 
        // Define the starting date for the sped-up calendar
        DateTime startingDate = new DateTime(2200, 1, 1);

        // Calculate the difference in days between the inputDate and the startingDate
        TimeSpan timeDifference = inputDate - startingDate;
        int daysElapsed = (int)timeDifference.TotalDays;

        // Calculate the year and day in the sped-up calendar
        int spedUpYear = daysElapsed / 14;
        int spedUpDay = daysElapsed % 14;

        // Create the sped-up calendar date
        DateTime spedUpDate = startingDate.AddDays(daysElapsed);

        // Set the year and day in the sped-up calendar
        spedUpDate = spedUpDate.AddYears(spedUpYear);
        spedUpDate = spedUpDate.AddDays(spedUpDay);

        return inputDate;
    }

    void SelectTile(int x, int y)
    {
        // Get the hexcode of the continent pixel
        //Color textureColor = mapSource.continentMap.GetPixel(x, y);
        //string continentColour = ColorUtility.ToHtmlStringRGB(textureColor);
        // Get the hexcode of the province pixel
        Color textureColor = mapSource.provinceMap.GetPixel(x, y);
        string provinceColour = ColorUtility.ToHtmlStringRGB(textureColor);
        // Get the hexcode of the tile pixel
        textureColor = tilePixels[y * width + x];
        string tileColour = ColorUtility.ToHtmlStringRGB(textureColor);

        FindTile(provinceColour, tileColour);
    }

    void FindTile(string provinceColour, string tileColour)
    {
        //method searches an appropriate subdatabase for the right tile data, reduces search time
        // Find right continent
        foreach (ContinentData c in mapSource.continents)
        {
            //if (c.HexCode != continentColour) continue;
            // Find right province inside continent
            foreach (ProvinceData p in c.Provinces)
            {
                if (p.HexCode != provinceColour) continue;
                // Find the tile
                foreach (TileData t in p.Tiles)
                {
                    if (t.HexCode == tileColour)
                    { 
                        selectedTile = t;
                        selectedProvince = p;
                        return;
                    }
                }
            }
        }

        Debug.Log("Tile " + tileColour + " not Found");
    }

    public CultureDef FindCulture(string hexCode)
    {
        foreach (CultureDef c in culturesList)
        {
            if (c.HexCode == hexCode) return c;
        }
        //If nothing return undefined values
        return new CultureDef
        {
            HexCode = hexCode,
            Dialect = "Undefined",
            Language = "Undefined",
            Group = "Undefined",
            SubGroup = "Undefined",
            Family = "Undefined",
        };
    }
    #endregion

}
