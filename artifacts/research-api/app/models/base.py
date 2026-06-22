"""
Base Pydantic model that all API response models extend.

Using a shared base ensures consistent serialization settings
(e.g. alias generation, JSON encoders) across all response types.

TODO: add model_config for OpenAPI example generation when models are fleshed out
"""

from pydantic import BaseModel


class BaseAPIResponse(BaseModel):
    """
    Shared base for all API response models.

    Subclass this for every response shape returned by the Research API.
    Configures Pydantic v2 serialization defaults.
    """

    model_config = {
        # Populate fields from both the field name and its alias
        "populate_by_name": True,
    }
