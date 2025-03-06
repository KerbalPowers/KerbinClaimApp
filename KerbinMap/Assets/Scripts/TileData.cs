using System;
using System.Collections.Generic;

[Serializable]
public class TileData
{
    public string HexCode;
    // Conditions
    public string Culture;
    // Resource
    public List<ResourceDef> LocalResources = new List<ResourceDef>();
    public double GDP;
    // Positional
    public UnityEngine.Vector2 Coordinates;
    public UnityEngine.Vector2 Position;
    public float Altitude;
    // KSP Biome effects movement
    public string Terrain;
    // Size
    public float Area;
    public int ProjectedArea;
    public int Population;
    // Positional
    public String ProvinceParent;
    public String ContinentParent;
    // Claim Value is an aggregate of local values
    public int ClaimValue;
}

[Serializable]
public class ProvinceData
{
    public string HexCode;
    // Positional
    public String ContinentParent;
    // Size for portion of values
    public float Area;
    public int Population;
    // Down bottom for json readablity
    public List<TileData> Tiles = new List<TileData>();
}

[Serializable]
public class ContinentData
{
    public string HexCode;
    // Down bottom for json readablity
    public List<ProvinceData> Provinces = new List<ProvinceData>();
}

[Serializable]
public class MapLocalisation
{
    public string HexCode;
    public string Name;
}

[Serializable]
public class CultureDef
{
    public string HexCode;
    public string Dialect;
    public string Language;
    public string SubGroup;
    public string Group;
    public string Family;
}

[Serializable]
public class ResourceDef
{
    public string Resource;
    public int Yield;

    public ResourceDef(string type, int yield)
    {
        this.Resource = type;
        this.Yield = yield;
    }
}
