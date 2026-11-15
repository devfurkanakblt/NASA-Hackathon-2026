"""Source-pinned mission points; regions are represented by explicitly labelled research points.

No polygon containment is inferred from a shared name or the nearest existing tile.
"""
APOLLO_SOURCE = "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html"
LANDER_SOURCE = "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html"
ARTEMIS_SOURCE = "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"
RESEARCH_SOURCE = "https://doi.org/10.1029/2025JE009434 (Wueller et al., Table A1)"


def point(name, lat, lon, source, program, dem="ldem64", status="landed"):
    return dict(name=name, lat=lat, lon=lon, coordSource=source, program=program,
                mission=name, dem=dem, category="contrast" if dem == "ldem64" else "mission",
                coordinateStatus=status,
                label=("Historical landing coordinate - terrain screening only; not a certified landing site"
                       if status == "landed" else "Representative research point - not an approved landing site"),
                notes=[("Terrain uses global LOLA LDEM_64 (~474 m/px); small hills are unresolved."
                        if dem == "ldem64" else
                        "Terrain uses the 80 m regional LOLA DEM; no local 5 m tile at this point."),
                       "Good illumination does not imply flat or safe terrain for landing."])


MISSION_SITES = {
    f"Apollo{n}": point(f"Apollo {n} landing site", lat, lon, APOLLO_SOURCE, "Apollo")
    for n, lat, lon in [(12, -3.0128, -23.4219), (14, -3.64589, -17.47194),
                        (15, 26.13239, 3.63330), (16, -8.9734, 15.5011), (17, 20.1911, 30.7723)]
}
for sid, name, lat, lon, dem in [
    ("IM1", "Intuitive Machines IM-1 (Odysseus)", -80.13, 1.44, "regional80"),
    ("IM2", "Intuitive Machines IM-2 (Athena)", -84.7906, 29.1957, "regional80"),
    ("BlueGhost1", "Firefly Blue Ghost Mission 1", 18.562, 61.810, "ldem64"),
    ("Chandrayaan3", "Chandrayaan-3 landing site", -69.3741, 32.32, "ldem64"),
    ("SLIM", "JAXA SLIM landing site", -13.3160, 25.2510, "ldem64"),
    ("CE3", "Chang'e-3 landing site", 44.1214, -19.5117, "ldem64"),
    ("CE4", "Chang'e-4 landing site", -45.4561, 177.5885, "ldem64"),
    ("CE5", "Chang'e-5 landing site", 43.0576, -51.9161, "ldem64"),
]:
    MISSION_SITES[sid] = point(name, lat, lon, LANDER_SOURCE,
                             "CLPS" if sid in ("IM1", "IM2", "BlueGhost1") else "International", dem)

MISSION_SITES["PeregrineTarget"] = point(
    "Astrobotic Peregrine target region (Sinus Viscositatis centre)", 35.25, -40.99,
    "https://planetarynames.wr.usgs.gov/Feature/16118 (LOLA 2011 feature centre); "
    "https://www.nasa.gov/missions/artemis/clps/astrobotic/ (mission/region association)",
    "CLPS", status="region-representative")
MISSION_SITES["PeregrineTarget"]["notes"] += [
    "Peregrine did not land on the Moon. This is the named target region centre, not a touchdown or precise target coordinate."]

# One published research candidate per NASA October 2024 region. These are NOT NASA-approved
# touchdown points or region centroids. The paper's candidate id remains in the name/source.
for sid, region, candidate, lat, lon in [
    ("ArtemisCabeusB", "Peak near Cabeus B", "PCB01", -83.7630, -69.9830),
    ("ArtemisHaworth", "Haworth", "HW01", -86.7680, -20.5140),
    ("ArtemisMalapert", "Malapert Massif", "MMA01", -85.9420, -0.9440),
    ("ArtemisMoutonPlateau", "Mons Mouton Plateau", "MMP01", -85.1110, 26.7100),
    ("ArtemisMouton", "Mons Mouton", "MMO01", -85.4160, 31.8510),
    ("ArtemisNobile1", "Nobile Rim 1", "NR101", -85.2950, 36.9170),
    ("ArtemisNobile2", "Nobile Rim 2", "NR201", -84.0540, 56.4810),
    ("ArtemisGerlache2", "de Gerlache Rim 2", "dGR201", -88.3890, -68.8650),
    ("ArtemisSlater", "Slater Plain", "SP01", -87.4780, 124.5210),
]:
    s = point(f"Artemis III 2024 region: {region} ({candidate}, research)", lat, lon,
              RESEARCH_SOURCE + f", {candidate}", "Artemis", "regional80", "research-candidate")
    s["regionSource"] = ARTEMIS_SOURCE
    s["notes"] += ["Historical October 2024 Artemis III candidate-region list; no current mission assignment is asserted.",
                    "Published research candidate represents one point, not the entire region or a NASA-approved landing site."]
    MISSION_SITES[sid] = s

# Verified that the complete 7 km near range fits the existing tile (not just the point).
for sid, tile in [("ArtemisMalapert", "Site23"), ("ArtemisMouton", "Site20")]:
    MISSION_SITES[sid].pop("dem")
    MISSION_SITES[sid]["tile"] = tile
    MISSION_SITES[sid]["category"] = "mission"
    MISSION_SITES[sid]["notes"][0] = f"Near terrain uses the existing {tile} LOLA 5 m tile; far terrain uses the 80 m DEM."
