# Browser key for Amazon Location map tiles (MapLibre). It is public by nature,
# so it is locked to tile reads and to our own origins.

terraform {
  required_version = ">= 1.10"

  required_providers {
    awscc = {
      source  = "hashicorp/awscc"
      version = "~> 1.0"
    }
  }
}

variable "env" {
  type = string
}

variable "region" {
  type = string
}

variable "allowed_origins" {
  description = "Origins (scheme://host[:port]) allowed to request tiles."
  type        = list(string)
}

resource "awscc_location_api_key" "maps" {
  key_name    = "rapport-maps-${var.env}"
  description = "Map tiles for the Rapport web app"
  no_expiry   = true

  restrictions = {
    allow_actions   = ["geo-maps:GetTile", "geo-maps:GetStaticMap"]
    allow_resources = ["arn:aws:geo-maps:${var.region}::provider/default"]
    allow_referers  = [for o in var.allowed_origins : "${o}/*"]
  }
}

output "key_name" {
  value = awscc_location_api_key.maps.key_name
}
