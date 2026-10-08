"""Canonical sections and field names, so the same fact lines up across the four sources.

Each source key is normalised (lower-case, letters and digits only) and looked up here.
Keys not listed keep their own name and are placed in the section of the source they came from.
"""
import re

SECTIONS = [
    "Overview", "Summary", "Hardware", "Interfaces", "Power", "Physical", "Environmental",
    "Cellular", "Wi-Fi", "Bluetooth", "Networking & Firewall", "VPN", "Remote Management",
    "Operating System & Software", "Gateway", "Compliance", "Packaging", "Website filters", "Other",
]


def nk(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# label, synonyms (normalised), per section
_C = {
    "Overview": [(x, []) for x in ("Product name", "Title", "Category", "Description", "Highlight tiles",
                                    "Highlight badges", "Use cases")],
    "Website filters": [(x, []) for x in ("Cellular generation", "Wi-Fi", "Ethernet ports", "RS485", "RS232")],
    "Summary": [
        ("Processor", ["processor", "cpu"]),
        ("Memory", ["ram", "memory"]),
        ("Storage", ["storage"]),
        ("Cellular", ["cellular"]),
        ("Wi-Fi", ["wifi"]),
        ("Ethernet", ["ethernet"]),
        ("Interface", ["interface", "inputoutput"]),
        ("Power", ["power"]),
        ("Operating System", ["operatingsystem", "os"]),
        ("USB", ["usb"]),
        ("Display", ["display"]),
        ("PoE Budget", ["poebudget"]),
        ("Housing", ["housing"]),
        ("Battery", ["battery"]),
    ],
    "Hardware": [
        ("CPU", ["cpu", "processor", "chipset"]),
        ("RAM", ["ram", "memory", "systemmemory"]),
        ("Flash", ["flash", "storageflash"]),
        ("Storage", ["storage", "internalstorage", "emmc"]),
        ("Cellular", ["cellular", "cell"]),
        ("SIM", ["sim"]),
        ("Wi-Fi", ["wifi", "wifihotspotandeasymesh"]),
        ("RTC", ["rtc", "rtcbatterybackup", "rtctemperature"]),
        ("Reset", ["reset", "button"]),
        ("Antenna", ["antenna", "antennas"]),
        ("Status LED", ["statusled", "statusleds", "leds", "ledindicators", "indicators"]),
        ("TPM", ["tpm"]),
        ("Boot Loader", ["bootloader"]),
        ("Graphics", ["graphics"]),
        ("Audio", ["audio"]),
    ],
    "Interfaces": [
        ("Ethernet", ["ethernet", "ethernetports", "ethernetinterfaces"]),
        ("WAN", ["wan"]),
        ("LAN", ["lan"]),
        ("SFP", ["sfp"]),
        ("USB", ["usb"]),
        ("Serial Interface", ["serialinterface", "serial"]),
        ("RS485", ["rs485"]),
        ("RS232", ["rs232"]),
        ("Digital Inputs", ["digitalinputs", "di"]),
        ("Digital Outputs", ["digitaloutputs", "relayoutputs", "do"]),
        ("Digital I/O", ["digitalinputsoutputs", "dio"]),
        ("Analog Inputs", ["analoginput", "analoginputs"]),
        ("Console", ["console"]),
        ("HDMI", ["hdmi"]),
        ("Type-C", ["typec"]),
        ("COM Port", ["comportoptional", "comport"]),
        ("Custom Expansion Interface", ["customexpansioninterface"]),
    ],
    "Power": [
        ("Power Connector", ["powerconnector"]),
        ("Input Voltage", ["inputvoltagerange", "inputpower", "inputvoltage", "powerinput"]),
        ("Power Adapter", ["poweradapter", "powersupply"]),
        ("Power Consumption", ["powerconsumption"]),
        ("PoE", ["poe"]),
        ("PoE Standard", ["poestandard"]),
        ("PoE Budget (Per Port)", ["poebudgetperport"]),
        ("Total PoE Budget", ["totalpoebudget"]),
    ],
    "Physical": [
        ("Enclosure", ["enclosure", "housing", "enclosurematerial"]),
        ("Mounting", ["mounting"]),
        ("Design", ["design"]),
        ("Dimensions", ["dimensions", "dimensionswxhxd", "dimensionswxdxh", "dimensionswhd", "dimensionswdh", "dimensionswxlxh", "dims"]),
        ("Weight", ["weight"]),
        ("IP Rating", ["ingressprotectionrating", "iprating", "ip"]),
        ("Colour", ["colour", "color"]),
    ],
    "Environmental": [
        ("Operating Temperature", ["operatingtemperature", "operatingtemp", "optemp", "workingtemperature"]),
        ("Storage Temperature", ["storagetemperature", "storagetemp"]),
        ("Humidity", ["humidity", "relativehumidity"]),
    ],
    "Cellular": [
        ("Cellular Module", ["cellularmodule", "cellularmode"]),
        ("Status", ["status"]),
        ("Band Management", ["bandmanagement"]),
        ("Operator Lock", ["operatorlock"]),
        ("APN", ["apn"]),
        ("Modem Configuration Mode", ["modemconfigurationmode"]),
        ("SIM Switching", ["simswitching"]),
        ("PDP Type", ["pdptype"]),
        ("SIM Authentication", ["simauthentication"]),
        ("SMS", ["sms"]),
    ],
    "Wi-Fi": [
        ("Technology", ["technology", "wifitechnology"]),
        ("Channel Selector", ["channelselector"]),
        ("Channel Width", ["channelwidth"]),
        ("Wi-Fi Mode", ["wifimode"]),
        ("TX Power", ["txpower"]),
        ("Authentication", ["authentication"]),
        ("Encryption", ["encryption"]),
        ("Wi-Fi Scheduler", ["wifischeduler"]),
        ("MAC ID Filtering", ["macidfiltering"]),
        ("Other", ["other"]),
    ],
    "Networking & Firewall": [
        ("Routing", ["routing"]),
        ("Network Protocols", ["networkprotocols"]),
        ("Connection Monitoring", ["connectionmonitoring", "monitoring"]),
        ("Firewall Features", ["firewallfeatures"]),
        ("Attack Prevention", ["attackprevention"]),
        ("DHCP", ["dhcp"]),
        ("Multi-WAN Configuration", ["multiwanconfiguration", "failover"]),
        ("VLAN", ["vlan"]),
        ("Other Networking", ["othernetworking"]),
        ("Internet Connectivity", ["internetconnectivity"]),
    ],
    "VPN": [
        ("VPN", ["vpn"]),
        ("OpenVPN", ["openvpn"]),
        ("IPsec", ["ipsec"]),
        ("PPTP/L2TP", ["pptpl2tpwan", "pptpl2tp"]),
    ],
    "Remote Management": [
        ("NMS", ["nms", "remotemanagement"]),
        ("NMS VPN", ["nmsvpn"]),
        ("TR069", ["tr069"]),
        ("SMS Commands", ["smscommands"]),
    ],
    "Operating System & Software": [
        ("Operating System", ["operatingsystem", "os"]),
        ("Supported Languages", ["supportedlanguages", "supportedlanguagestools", "tools"]),
        ("Development Tools", ["developmenttools", "sdkpackage"]),
        ("Software Support", ["softwaresupport"]),
    ],
    "Packaging": [
        ("Standard Packaging", ["standardpackaging", "standardpacking"]),
    ],
}

# Keys whose meaning depends on the section they appear in; never moved by the global lookup.
AMBIGUOUS = {"other", "status", "power", "interface", "description", "mode", "ports", "cellular", "wifi",
             "ethernet", "usb", "storage", "processor", "operatingsystem", "os", "memory", "cpu", "ram",
             "housing", "battery", "display"}

LOOKUP = {}          # (section, nk) -> label
GLOBAL = {}          # nk -> (section, label) for unambiguous keys
for sec, items in _C.items():
    if sec in ("Overview", "Website filters"):
        continue
    for label, syns in items:
        for s in syns + [nk(label)]:
            LOOKUP[(sec, s)] = label
            if sec != "Summary" and s not in AMBIGUOUS:
                GLOBAL.setdefault(s, (sec, label))

ORDER = {}           # (section, label) -> position, for display order
for si, sec in enumerate(SECTIONS):
    for li, (label, _) in enumerate(_C.get(sec, [])):
        ORDER[(sec, label)] = si * 1000 + li

# source section names -> canonical section
SECMAP = {
    "hardwarespecification": "Hardware", "hardware": "Hardware", "specifications": "Hardware",
    "physical": "Physical", "operationalenvironmental": "Environmental",
    "cellular": "Cellular", "wifi": "Wi-Fi", "bluetoothspecifications": "Bluetooth",
    "firewallnetworking": "Networking & Firewall", "remotemanagement": "Remote Management",
    "operatingsystem": "Operating System & Software", "software": "Operating System & Software",
    "gateway": "Gateway", "regulatoryandapprovals": "Compliance", "compliance": "Compliance",
    "features": "Other", "productinfo": "Summary", "brief": "Summary",
}


for _s in SECTIONS:
    SECMAP.setdefault(nk(_s), _s)


def place(src_section, key):
    """Return (section, label) for a key found in src_section of some source."""
    k = nk(key.split("›")[-1]) if "›" in key else nk(key)
    sec = SECMAP.get(nk(src_section), "Other")
    if sec == "Summary":
        return sec, LOOKUP.get((sec, k), key.strip().title() if key.isupper() else key.strip())
    if (sec, k) in LOOKUP:
        return sec, LOOKUP[(sec, k)]
    if sec == "Hardware":                       # hardware tables mix interfaces, power, physical, environment
        for s2 in ("Interfaces", "Power", "Physical", "Environmental"):
            if (s2, k) in LOOKUP:
                return s2, LOOKUP[(s2, k)]
    if k in GLOBAL and k not in AMBIGUOUS:
        return GLOBAL[k]
    label = key.strip()
    if "›" in label:
        label = " › ".join(p.strip() for p in label.split("›"))
    return sec, label


def order(section, label):
    base = SECTIONS.index(section) * 1000 if section in SECTIONS else 99000
    return ORDER.get((section, label), base + 900)
