def test_version_is_string() -> None:
    import vater_core

    assert isinstance(vater_core.__version__, str) and vater_core.__version__
